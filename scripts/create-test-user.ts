import { createConnectionManager } from '../src/storage/connection.js';
import { hashPassword } from '../src/storage/auth-crypto.js';

const connection = createConnectionManager('./data/app.db');
connection.open();

try {
  // 删除旧的测试用户
  connection.exec("DELETE FROM users WHERE username = 'qatest'");
  
  // 创建新用户
  const passwordHash = await hashPassword('qatest123');
  const userId = 'qatest-user-id';
  const now = new Date().toISOString();
  
  connection.exec(
    `INSERT INTO users (user_id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, 'qatest', passwordHash, now, now]
  );
  
  console.log('User created successfully');
  
  const users = connection.query('SELECT user_id, username, created_at FROM users WHERE username = ?', ['qatest']);
  console.log('Users:', JSON.stringify(users, null, 2));
} catch (e) {
  console.error('Error:', e);
} finally {
  connection.close();
}
