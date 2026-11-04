import mysql from 'mysql2/promise';
import { config } from './config.js';

// Pool de conexões: reaproveita conexões abertas em vez de abrir uma por requisição.
export const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'local',
    dateStrings: true,       // datas voltam como texto ('2026-11-03'), sem conversão de fuso
    decimalNumbers: false,   // DECIMAL volta como texto, evitando erros de arredondamento
});

/**
 * Executa uma função dentro de uma transação.
 * Se a função lançar erro, tudo é desfeito (rollback).
 */
export async function transacao(fn) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const resultado = await fn(conn);
        await conn.commit();
        return resultado;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}
