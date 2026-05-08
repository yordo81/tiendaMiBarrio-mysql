#!/usr/bin/env node
/**
 * TiendaMiBarrio - Database Setup Script
 * Usage: node scripts/setup-db.js
 * 
 * This script creates the database, runs the schema, and creates the owner user.
 * Requires: npm install (to install mysql2 and bcryptjs first)
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load .env.local if it exists
try {
  const env = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf-8');
  env.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !key.startsWith('#')) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  });
} catch {}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function main() {
  console.log('\n🛒  TiendaMiBarrio — Database Setup\n');

  const host     = process.env.DB_HOST     || await ask('MySQL host [localhost]: ') || 'localhost';
  const port     = process.env.DB_PORT     || await ask('MySQL port [3306]: ')      || '3306';
  const user     = process.env.DB_USER     || await ask('MySQL user [root]: ')      || 'root';
  const password = process.env.DB_PASSWORD || await ask('MySQL password: ');
  const dbName   = process.env.DB_NAME     || await ask('Database name [tienda_mi_barrio]: ') || 'tienda_mi_barrio';

  console.log('\n📦  Connecting to MySQL...');

  // Connect without selecting a DB first
  const conn = await mysql.createConnection({ host, port: parseInt(port), user, password });

  // Create DB if needed
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${dbName}\``);
  console.log(`✅  Database '${dbName}' ready.`);

  // Run schema
  const schema = fs.readFileSync(path.join(__dirname, '../mysql/schema.sql'), 'utf-8');
  // Split on semicolons, filter empties, skip USE/CREATE DATABASE lines
  const statements = schema.split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.toUpperCase().startsWith('CREATE DATABASE') && !s.toUpperCase().startsWith('USE '));

  let ok = 0, skip = 0;
  for (const stmt of statements) {
    try { await conn.query(stmt + ';'); ok++; } catch(e) { if (!e.message.includes('already exists')) { console.warn('⚠ ', e.message); } else { skip++; } }
  }
  console.log(`✅  Schema applied (${ok} statements, ${skip} already existed).`);

  // Check if owner already exists
  const [rows] = await conn.query("SELECT id FROM users WHERE role='owner' LIMIT 1");
  if ((rows).length > 0) {
    console.log('ℹ️   Owner user already exists. Skipping user creation.');
    await conn.end(); rl.close();
    console.log('\n🎉  Setup complete! Run: npm run dev\n');
    return;
  }

  // Create owner user
  console.log('\n👤  Create owner account:');
  const ownerName  = await ask('Owner name [Admin]: ') || 'Admin';
  const ownerEmail = await ask('Owner email: ');
  const ownerPass  = await ask('Owner password: ');

  if (!ownerEmail || !ownerPass) { console.error('❌  Email and password are required.'); process.exit(1); }

  const { randomUUID } = require('crypto');
  const hash = await bcrypt.hash(ownerPass, 12);
  const id = randomUUID();
  const now = new Date().toISOString().slice(0,19).replace('T',' ');

  await conn.query(
    'INSERT INTO users (id,name,email,password_hash,role,permissions,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)',
    [id, ownerName, ownerEmail.toLowerCase().trim(), hash, 'owner', '[]', now, now]
  );

  console.log(`\n✅  Owner created: ${ownerEmail}`);
  await conn.end(); rl.close();
  console.log('\n🎉  Setup complete! Run: npm run dev\n');
}

main().catch(e => { console.error('❌ Setup failed:', e.message); process.exit(1); });
