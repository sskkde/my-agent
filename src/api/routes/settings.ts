import type { FastifyInstance } from 'fastify';
import type { SettingsConfig, SettingsResponse } from '../types.js';
import type { ApiContext } from '../context.js';

export function registerSettingsRoutes(server: FastifyInstance, _context: ApiContext): void {
  server.get<{ Reply: { data: SettingsResponse } }>('/api/settings', async (): Promise<{ data: SettingsResponse }> => {
    const settings: SettingsConfig = {
      localOnly: true,
      providers: {
        openrouter: {
          configured: !!process.env.OPENROUTER_API_KEY,
        },
        ollama: {
          configured: !!process.env.OLLAMA_BASE_URL,
        },
      },
      retentionDays: 30,
    };

    return { data: { settings } };
  });
}
