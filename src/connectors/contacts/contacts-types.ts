import type { IHttpTransport } from '../base-http-transport-types.js'

export interface ContactName {
  displayName?: string
  givenName?: string
  familyName?: string
  middleName?: string
  honorificPrefix?: string
  honorificSuffix?: string
}

export interface ContactEmailAddress {
  value: string
  type?: string
  displayName?: string
}

export interface ContactPhoneNumber {
  value: string
  type?: string
  canonicalForm?: string
}

export interface ContactOrganization {
  name?: string
  title?: string
  department?: string
  location?: string
}

export interface ContactAddress {
  formattedValue?: string
  streetAddress?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  type?: string
}

export interface Contact {
  id: string
  resourceName: string
  etag?: string
  names?: ContactName[]
  emailAddresses?: ContactEmailAddress[]
  phoneNumbers?: ContactPhoneNumber[]
  organizations?: ContactOrganization[]
  addresses?: ContactAddress[]
  photos?: Array<{ url: string; default?: boolean }>
  urls?: Array<{ value: string; type?: string }>
  biographies?: Array<{ value: string; contentType?: string }>
  metadata?: {
    sources?: Array<{
      type: string
      id: string
      updateTime?: string
    }>
  }
}

export interface ListContactsParams {
  pageSize?: number
  pageToken?: string
  personFields?: string
  requestSyncToken?: boolean
  syncToken?: string
}

export interface ListContactsResponse {
  contacts: Contact[]
  nextPageToken?: string
  totalSize: number
  syncToken?: string
}

export interface GetContactParams {
  resourceName: string
  personFields?: string
}

export interface CreateContactParams {
  contact: {
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
}

export interface SearchContactsParams {
  query: string
  pageSize?: number
  readMask?: string
}

export interface SearchContactsResponse {
  contacts: Contact[]
  totalSize: number
}

export interface ContactsTransport {
  listContacts(params: ListContactsParams): Promise<ListContactsResponse>
  getContact(params: GetContactParams): Promise<Contact | null>
  createContact(params: CreateContactParams): Promise<Contact>
  searchContacts(params: SearchContactsParams): Promise<SearchContactsResponse>
  validateAuth(): Promise<boolean>
}

export type ContactsProvider = 'google' | 'microsoft'

export interface ContactsConnectorConfig {
  transport?: ContactsTransport
  provider?: ContactsProvider
  useMock?: boolean
}

export interface GooglePeopleApiConfig {
  accessToken: string
  transport?: IHttpTransport
}

export interface MicrosoftGraphConfig {
  accessToken: string
  transport?: IHttpTransport
}

export type ContactsErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

export interface ContactsError {
  code: ContactsErrorCode
  message: string
  recoverable: boolean
  details?: {
    statusCode?: number
    rateLimitRemaining?: number
    rateLimitResetAt?: string
  }
}

export const DEFAULT_PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,organizations,addresses,photos,urls,biographies'
