import { Router } from 'express';
import { pool } from '../db.js';
import { buscarItens } from '../services/vendas.js';

export const inicioRouter = Router();

/**
 * Resumo da tela inicial: vendas do mês atual (total, quantidade e últimas vendas)
 * e o estoque atual de todas as matérias-primas.
 */
inicioRouter.get('/', async (req, res) => {
    const [[mes]] = await pool.query(
        `SELECT COALESCE(SUM(valor_total), 0) AS total, COUNT(*) AS quantidade,
                DATE_FORMAT(CURDATE(), '%Y-%m-01') AS inicio, CURDATE() AS hoje
           FROM vendas
          WHERE data_venda BETWEEN DATE_FORMAT(CURDATE(), '%Y-%m-01') AND LAST_DAY(CURDATE())`,
    );

    const [ultimas] = await pool.query(
        `SELECT v.id, c.nome AS cliente, v.data_venda, v.valor_total, v.pagamento
           FROM vendas v JOIN clientes c ON c.id = v.cliente_id
          ORDER BY v.data_venda DESC, v.id DESC
          LIMIT 5`,
    );
    const itens = await buscarItens(pool, ultimas.map((u) => u.id));

    const [estoque] = await pool.query(
        `SELECT id, nome, unidade, quantidade, ultima_alteracao_em
           FROM materias_primas ORDER BY nome`,
    );

    res.json({
        vendasMes: { total: mes.total, quantidade: Number(mes.quantidade), inicio: mes.inicio, hoje: mes.hoje },
        ultimasVendas: ultimas.map((u) => ({ ...u, itens: itens.get(u.id) })),
        estoque,
    });
});
