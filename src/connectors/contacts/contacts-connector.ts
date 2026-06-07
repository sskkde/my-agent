import type { ConnectorAdapter, ConnectorCapability, ConnectorCallRequest } from '../types.js'
import type { ConnectorInstance } from '../../storage/connector-store.js'
import {
  encryptSecret,
  decryptSecret,
  deserializeEncryptedSecret,
  serializeEncryptedSecret,
} from '../../storage/provider-crypto.js'
import { BaseHttpTransport, TransportError } from '../base-http-transport.js'
import type {
  ContactsTransport,
  Contact,
  ListContactsParams,
  ListContactsResponse,
  GetContactParams,
  CreateContactParams,
  SearchContactsParams,
  SearchContactsResponse,
  ContactsConnectorConfig,
  ContactsError,
} from './contacts-types.js'
import { DEFAULT_PERSON_FIELDS } from './contacts-types.js'

const GOOGLE_PEOPLE_API_BASE = 'https://people.googleapis.com/v1'

const CONTACTS_CAPABILITIES: ConnectorCapability[] = [
  {
    capabilityId: 'contacts.list_contacts',
    name: 'List Contacts',
    description: 'List all contacts from the connected account',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      pageSize: { type: 'number', description: 'Number of contacts per page' },
      pageToken: { type: 'string', description: 'Token for pagination' },
    },
    requiresAuth: true,
    supportedOperations: ['list_contacts'],
  },
  {
    capabilityId: 'contacts.get_contact',
    name: 'Get Contact',
    description: 'Get a specific contact by resource name',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      resourceName: { type: 'string', description: 'Contact resource name' },
    },
    requiresAuth: true,
    supportedOperations: ['get_contact'],
  },
  {
    capabilityId: 'contacts.create_contact',
    name: 'Create Contact',
    description: 'Create a new contact',
    category: 'write',
    riskLevel: 'medium',
    inputSchema: {
      contact: { type: 'object', description: 'Contact data to create' },
    },
    requiresAuth: true,
    supportedOperations: ['create_contact'],
  },
  {
    capabilityId: 'contacts.search_contacts',
    name: 'Search Contacts',
    description: 'Search contacts by name, email, or other fields',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      query: { type: 'string', description: 'Search query' },
      pageSize: { type: 'number', description: 'Maximum results to return' },
    },
    requiresAuth: true,
    supportedOperations: ['search_contacts'],
  },
]

interface GooglePeopleListResponse {
  connections?: Array<{
    resourceName: string
    etag?: string
    names?: Array<{
      displayName: string
      givenName?: string
      familyName?: string
      middleName?: string
      honorificPrefix?: string
      honorificSuffix?: string
    }>
    emailAddresses?: Array<{
      value: string
      type?: string
      displayName?: string
    }>
    phoneNumbers?: Array<{
      value: string
      type?: string
      canonicalForm?: string
    }>
    organizations?: Array<{
      name?: string
      title?: string
      department?: string
      location?: string
    }>
    addresses?: Array<{
      formattedValue?: string
      streetAddress?: string
      city?: string
      region?: string
      postalCode?: string
      country?: string
      type?: string
    }>
    photos?: Array<{
      url: string
      default?: boolean
    }>
    urls?: Array<{
      value: string
      type?: string
    }>
    biographies?: Array<{
      value: string
      contentType?: string
    }>
    metadata?: {
      sources?: Array<{
        type: string
        id: string
        updateTime?: string
      }>
    }
  }>
  nextPageToken?: string
  totalItems?: number
  syncToken?: string
}

interface GooglePeopleSearchResponse {
  results?: Array<{
    person: GooglePeopleListResponse['connections'] extends (infer T)[] | undefined ? T : never
  }>
  totalSize?: number
}

interface GooglePeopleContact {
  resourceName?: string
  etag?: string
  names?: Array<{
    givenName?: string
    familyName?: string
    middleName?: string
    honorificPrefix?: string
    honorificSuffix?: string
  }>
  emailAddresses?: Array<{
    value: string
    type?: string
    displayName?: string
  }>
  phoneNumbers?: Array<{
    value: string
    type?: string
  }>
  organizations?: Array<{
    name?: string
    title?: string
    department?: string
  }>
  addresses?: Array<{
    formattedValue?: string
    streetAddress?: string
    city?: string
    region?: string
    postalCode?: string
    country?: string
    type?: string
  }>
}

export class GooglePeopleApiTransport implements ContactsTransport {
  private httpTransport: BaseHttpTransport

  constructor(accessToken: string) {
    this.httpTransport = new BaseHttpTransport({
      baseURL: GOOGLE_PEOPLE_API_BASE,
      auth: { type: 'oauth2', credentials: accessToken },
      timeout: 30000,
      retries: 3,
    })
  }

  async validateAuth(): Promise<boolean> {
    try {
      await this.httpTransport.get<{ person: { resourceName: string } }>('/people/me', { personFields: 'names' })
      return true
    } catch {
      return false
    }
  }

  async listContacts(params: ListContactsParams): Promise<ListContactsResponse> {
    const queryParams: Record<string, string> = {
      personFields: params.personFields ?? DEFAULT_PERSON_FIELDS,
    }
    if (params.pageSize) queryParams.pageSize = String(params.pageSize)
    if (params.pageToken) queryParams.pageToken = params.pageToken
    if (params.requestSyncToken) queryParams.requestSyncToken = 'true'
    if (params.syncToken) queryParams.syncToken = params.syncToken

    const response = await this.httpTransport.get<GooglePeopleListResponse>('/people/me/connections', queryParams)

    const contacts = (response.body?.connections ?? []).map(this.mapGoogleContact)
    return {
      contacts,
      nextPageToken: response.body?.nextPageToken,
      totalSize: response.body?.totalItems ?? contacts.length,
      syncToken: response.body?.syncToken,
    }
  }

  async getContact(params: GetContactParams): Promise<Contact | null> {
    try {
      const queryParams: Record<string, string> = {
        personFields: params.personFields ?? DEFAULT_PERSON_FIELDS,
      }

      const response = await this.httpTransport.get<
        GooglePeopleListResponse['connections'] extends (infer T)[] | undefined ? T : never
      >(`/${params.resourceName}`, queryParams)

      if (!response.body) return null
      return this.mapGoogleContact(response.body)
    } catch (error) {
      if (error instanceof TransportError && error.statusCode === 404) {
        return null
      }
      throw error
    }
  }

  async createContact(params: CreateContactParams): Promise<Contact> {
    const googleContact: GooglePeopleContact = {
      names: params.contact.names?.map((n) => ({
        givenName: n.givenName,
        familyName: n.familyName,
        middleName: n.middleName,
        honorificPrefix: n.honorificPrefix,
        honorificSuffix: n.honorificSuffix,
      })),
      emailAddresses: params.contact.emailAddresses?.map((e) => ({
        value: e.value,
        type: e.type,
        displayName: e.displayName,
      })),
      phoneNumbers: params.contact.phoneNumbers?.map((p) => ({
        value: p.value,
        type: p.type,
      })),
      organizations: params.contact.organizations?.map((o) => ({
        name: o.name,
        title: o.title,
        department: o.department,
      })),
      addresses: params.contact.addresses?.map((a) => ({
        formattedValue: a.formattedValue,
        streetAddress: a.streetAddress,
        city: a.city,
        region: a.region,
        postalCode: a.postalCode,
        country: a.country,
        type: a.type,
      })),
    }

    const response = await this.httpTransport.post<
      GooglePeopleListResponse['connections'] extends (infer T)[] | undefined ? T : never
    >('/people:createContact', googleContact)

    return this.mapGoogleContact(response.body!)
  }

  async searchContacts(params: SearchContactsParams): Promise<SearchContactsResponse> {
    const queryParams: Record<string, string> = {
      query: params.query,
      readMask: params.readMask ?? DEFAULT_PERSON_FIELDS,
    }
    if (params.pageSize) queryParams.pageSize = String(params.pageSize)

    const response = await this.httpTransport.get<GooglePeopleSearchResponse>('/people:searchContacts', queryParams)

    const contacts = (response.body?.results ?? []).map((r) => this.mapGoogleContact(r.person))
    return {
      contacts,
      totalSize: response.body?.totalSize ?? contacts.length,
    }
  }

  private mapGoogleContact(googleContact: NonNullable<GooglePeopleListResponse['connections']>[number]): Contact {
    return {
      id: googleContact.resourceName,
      resourceName: googleContact.resourceName,
      etag: googleContact.etag,
      names: googleContact.names?.map((n) => ({
        displayName: n.displayName,
        givenName: n.givenName,
        familyName: n.familyName,
        middleName: n.middleName,
        honorificPrefix: n.honorificPrefix,
        honorificSuffix: n.honorificSuffix,
      })),
      emailAddresses: googleContact.emailAddresses?.map((e) => ({
        value: e.value,
        type: e.type,
        displayName: e.displayName,
      })),
      phoneNumbers: googleContact.phoneNumbers?.map((p) => ({
        value: p.value,
        type: p.type,
        canonicalForm: p.canonicalForm,
      })),
      organizations: googleContact.organizations?.map((o) => ({
        name: o.name,
        title: o.title,
        department: o.department,
        location: o.location,
      })),
      addresses: googleContact.addresses?.map((a) => ({
        formattedValue: a.formattedValue,
        streetAddress: a.streetAddress,
        city: a.city,
        region: a.region,
        postalCode: a.postalCode,
        country: a.country,
        type: a.type,
      })),
      photos: googleContact.photos,
      urls: googleContact.urls,
      biographies: googleContact.biographies,
      metadata: googleContact.metadata,
    }
  }
}

export class ContactsConnectorAdapter implements ConnectorAdapter {
  private transport: ContactsTransport

  constructor(config: ContactsConnectorConfig) {
    if (config.transport) {
      this.transport = config.transport
    } else if (process.env.CONTACTS_MOCK_MODE === 'true' || config.useMock) {
      this.transport = new MockContactsTransport()
    } else {
      this.transport = new GooglePeopleApiTransport('')
    }
  }

  async execute(instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const accessToken = this.decryptAccessToken(instance)

    if (this.transport instanceof GooglePeopleApiTransport) {
      this.transport = new GooglePeopleApiTransport(accessToken)
    }

    const { operation, params } = request

    switch (operation) {
      case 'list_contacts':
        return this.listContacts(params as unknown as ListContactsParams)

      case 'get_contact':
        return this.getContact(params as unknown as GetContactParams)

      case 'create_contact':
        return this.createContact(params as unknown as CreateContactParams)

      case 'search_contacts':
        return this.searchContacts(params as unknown as SearchContactsParams)

      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return CONTACTS_CAPABILITIES
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'Contacts connector is healthy' }
  }

  private async listContacts(params: ListContactsParams): Promise<ListContactsResponse> {
    return this.transport.listContacts(params)
  }

  private async getContact(params: GetContactParams): Promise<Contact | null> {
    return this.transport.getContact(params)
  }

  private async createContact(params: CreateContactParams): Promise<Contact> {
    return this.transport.createContact(params)
  }

  private async searchContacts(params: SearchContactsParams): Promise<SearchContactsResponse> {
    return this.transport.searchContacts(params)
  }

  private decryptAccessToken(instance: ConnectorInstance): string {
    if (!instance.authStateRef) {
      throw this.createAuthError('No authentication configured')
    }

    try {
      const encrypted = deserializeEncryptedSecret(instance.authStateRef)
      return decryptSecret(encrypted.encrypted, encrypted.iv, encrypted.authTag)
    } catch {
      throw this.createAuthError('Failed to decrypt access token')
    }
  }

  static encryptAccessToken(accessToken: string): string {
    const encrypted = encryptSecret(accessToken)
    return serializeEncryptedSecret(encrypted)
  }

  private createAuthError(message: string): ContactsError {
    const error = new Error(message) as Error & ContactsError
    error.code = 'AUTH_INVALID'
    error.message = message
    error.recoverable = false
    throw error
  }
}

class MockContactsTransport implements ContactsTransport {
  private mockContacts: Contact[] = [
    {
      id: 'people/123456789',
      resourceName: 'people/123456789',
      names: [{ displayName: 'John Doe', givenName: 'John', familyName: 'Doe' }],
      emailAddresses: [{ value: 'john.doe@example.com', type: 'work' }],
      phoneNumbers: [{ value: '+1-555-0101', type: 'mobile' }],
      organizations: [{ name: 'Acme Corp', title: 'Software Engineer' }],
    },
    {
      id: 'people/987654321',
      resourceName: 'people/987654321',
      names: [{ displayName: 'Jane Smith', givenName: 'Jane', familyName: 'Smith' }],
      emailAddresses: [{ value: 'jane.smith@company.com', type: 'work' }],
      phoneNumbers: [{ value: '+1-555-0102', type: 'work' }],
      organizations: [{ name: 'Tech Solutions', title: 'Product Manager' }],
    },
    {
      id: 'people/111222333',
      resourceName: 'people/111222333',
      names: [{ displayName: 'Bob Johnson', givenName: 'Bob', familyName: 'Johnson' }],
      emailAddresses: [{ value: 'bob.j@partner.com', type: 'work' }],
      phoneNumbers: [{ value: '+1-555-0103', type: 'work' }],
      organizations: [{ name: 'Partner LLC', title: 'Sales Director' }],
    },
  ]

  async validateAuth(): Promise<boolean> {
    return true
  }

  async listContacts(params: ListContactsParams): Promise<ListContactsResponse> {
    const pageSize = params.pageSize ?? 10
    return {
      contacts: this.mockContacts.slice(0, pageSize),
      totalSize: this.mockContacts.length,
    }
  }

  async getContact(params: GetContactParams): Promise<Contact | null> {
    return this.mockContacts.find((c) => c.resourceName === params.resourceName) ?? null
  }

  async createContact(params: CreateContactParams): Promise<Contact> {
    const id = `people/${Date.now()}`
    const newContact: Contact = {
      id,
      resourceName: id,
      names: params.contact.names?.map((n) => ({
        displayName: `${n.givenName ?? ''} ${n.familyName ?? ''}`.trim(),
        givenName: n.givenName,
        familyName: n.familyName,
      })),
      emailAddresses: params.contact.emailAddresses,
      phoneNumbers: params.contact.phoneNumbers,
      organizations: params.contact.organizations,
    }
    this.mockContacts.push(newContact)
    return newContact
  }

  async searchContacts(params: SearchContactsParams): Promise<SearchContactsResponse> {
    const lowerQuery = params.query.toLowerCase()
    const filtered = this.mockContacts.filter(
      (c) =>
        c.names?.some((n) => n.displayName?.toLowerCase().includes(lowerQuery)) ||
        c.emailAddresses?.some((e) => e.value.toLowerCase().includes(lowerQuery)),
    )
    return {
      contacts: filtered.slice(0, params.pageSize ?? 10),
      totalSize: filtered.length,
    }
  }
}

export function createContactsConnectorAdapter(config: ContactsConnectorConfig = {}): ContactsConnectorAdapter {
  return new ContactsConnectorAdapter(config)
}
