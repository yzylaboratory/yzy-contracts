import type { Client, ClientPage, YzyApi } from '../contract';
import type { ApiClient } from './client';
import { toQuery } from './client';
import { mapClient } from './map-case';
import { clientPageSchema, clientSchema } from './wire-schema';

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function createHttpClientsApi(http: ApiClient): YzyApi['clients'] {
  return {
    async list(params): Promise<ClientPage> {
      const page = await http.json(
        `/clients${toQuery([
          ['q', params.q],
          ['page', params.page],
          ['per_page', params.perPage],
        ])}`,
        clientPageSchema,
      );
      return {
        items: page.items.map(mapClient),
        total: page.total,
        page: page.page,
        per_page: page.per_page,
      };
    },
    async get(id: string): Promise<Client> {
      const client = await http.json(`/clients/${segment(id)}`, clientSchema);
      return mapClient(client);
    },
    async create(body): Promise<Client> {
      const client = await http.json('/clients', clientSchema, { method: 'POST', body });
      return mapClient(client);
    },
  };
}
