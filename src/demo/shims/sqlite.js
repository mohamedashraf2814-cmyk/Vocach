// بديل node:sqlite باستخدام sql.js (SQLite مترجمة لجافاسكربت)
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { load } from '../storage.js';

const SQL = await initSqlJs();
const saved = await load('db');
export const sqlDb = saved ? new SQL.Database(saved) : new SQL.Database();

const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : typeof p === 'bigint' ? Number(p) : p));

export class DatabaseSync {
  exec(sql) { sqlDb.exec(sql); }
  prepare(sql) {
    return {
      get(...params) {
        const st = sqlDb.prepare(sql);
        try { st.bind(norm(params)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
      },
      all(...params) {
        const st = sqlDb.prepare(sql);
        const rows = [];
        try { st.bind(norm(params)); while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); }
        return rows;
      },
      run(...params) {
        sqlDb.run(sql, norm(params));
        const changes = sqlDb.getRowsModified();
        const id = sqlDb.exec('SELECT last_insert_rowid()')[0].values[0][0];
        return { changes, lastInsertRowid: id };
      },
    };
  }
}
