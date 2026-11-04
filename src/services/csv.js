/**
 * Gera CSV compatível com o Excel em português:
 * separador ";" , vírgula decimal e BOM UTF-8 (para os acentos aparecerem corretamente).
 *
 * blocos: [{ titulo?, colunas: [texto], linhas: [[valor]] }]
 * Blocos são separados por uma linha em branco.
 */
export function gerarCsv(blocos) {
    const linhas = [];
    blocos.forEach((b, i) => {
        if (i > 0) linhas.push('');
        if (b.titulo) linhas.push(celula(b.titulo));
        linhas.push(b.colunas.map(celula).join(';'));
        for (const l of b.linhas) linhas.push(l.map(celula).join(';'));
    });
    return '﻿' + linhas.join('\r\n') + '\r\n';
}

function celula(v) {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Evita que o Excel interprete o texto como fórmula (injeção de fórmula em CSV).
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Envia o CSV como download. */
export function enviarCsv(res, nomeArquivo, blocos) {
    res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
    });
    res.send(gerarCsv(blocos));
}

/** Número para CSV com vírgula decimal (sem separador de milhar, para o Excel somar). */
export const numeroCsv = (n, casas) => Number(n).toFixed(casas).replace('.', ',');
