import { createConnectionManager } from '../src/storage/connection.js';

const connection = createConnectionManager('./data/app.db');
connection.open();

try {
  const tables = connection.query("SELECT name FROM sqlite_master WHERE type='table'");
  console.log('Tables:', JSON.stringify(tables, null, 2));
  
  const users = connection.query('SELECT * FROM users');
  console.log('Users:', JSON.stringify(users, null, 2));
} catch (e) {
  console.error('Error:', e);
} finally {
  connection.close();
}
