import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function test() {
    try {
        const db = await open({
            filename: './barpay.db',
            driver: sqlite3.Database
        });
        await db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)');
        await db.run('INSERT INTO test (id) VALUES (?)', [1]);
        console.log('Database write successful');
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
