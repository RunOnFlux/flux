import { closeDb } from './db-client.js';

export const mochaHooks = {
  async afterAll() {
    await closeDb();
  },
};
