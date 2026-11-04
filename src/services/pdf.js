import PDFDocument from 'pdfkit';

const COR_PRINCIPAL = '#315C45';
const COR_TEXTO = '#333333';
const COR_SECUNDARIA = '#777777';
const COR_BORDA = '#DDDDDD';
const COR_FUNDO_CABECALHO = '#F7F3E8';

/**
 * Gera um relatório em PDF e envia como download.
 *
 * opcoes = {
 *   titulo, subtitulo?, paisagem?,
 *   filtros: [[rótulo, valor]],
 *   blocos: [{
 *     titulo?,
 *     colunas: [{ titulo, largura (proporção), alinhar: 'left'|'right'|'center' }],
 *     linhas: [[texto]],
 *     totais?: [texto],          // linha final em negrito
 *     vazio?: 'texto quando não houver linhas'
 *   }]
 * }
 */
export function enviarPdf(res, nomeArquivo, opcoes) {
    const doc = new PDFDocument({
        size: 'A4',
        layout: opcoes.paisagem ? 'landscape' : 'portrait',
        margins: { top: 40, bottom: 50, left: 40, right: 40 },
        bufferPages: true,
        info: { Title: opcoes.titulo, Author: 'Isadora ERP' },
    });

    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
    });
    doc.pipe(res);

    const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const esquerda = doc.page.margins.left;

    // ---------- Cabeçalho do documento
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COR_PRINCIPAL).text('ISADORA ERP', esquerda, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(COR_TEXTO).text(opcoes.titulo);
    if (opcoes.subtitulo) {
        doc.font('Helvetica').fontSize(11).fillColor(COR_SECUNDARIA).text(opcoes.subtitulo);
    }
    doc.moveDown(0.6);

    for (const [rotulo, valor] of opcoes.filtros ?? []) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COR_TEXTO).text(`${rotulo}: `, { continued: true })
            .font('Helvetica').text(valor, { width: largura });
    }
    doc.font('Helvetica').fontSize(8).fillColor(COR_SECUNDARIA)
        .text(`Emitido em ${new Date().toLocaleString('pt-BR')}`);
    doc.moveDown(0.8);
    linhaHorizontal(doc, esquerda, largura, COR_PRINCIPAL, 1.5);
    doc.moveDown(0.8);

    // ---------- Blocos (tabelas)
    for (const bloco of opcoes.blocos) {
        desenharTabela(doc, bloco, esquerda, largura);
        doc.moveDown(1.2);
    }

    // ---------- Rodapé com numeração de páginas
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
        doc.switchToPage(paginas.start + i);
        const margemInferior = doc.page.margins.bottom;
        doc.page.margins.bottom = 0; // permite escrever no rodapé sem criar página nova
        doc.font('Helvetica').fontSize(8).fillColor(COR_SECUNDARIA).text(
            `${opcoes.titulo}  •  Página ${i + 1} de ${paginas.count}`,
            esquerda, doc.page.height - 30, { width: largura, align: 'center', lineBreak: false },
        );
        doc.page.margins.bottom = margemInferior;
    }

    doc.end();
}

function linhaHorizontal(doc, x, largura, cor = COR_BORDA, espessura = 0.5) {
    doc.save().moveTo(x, doc.y).lineTo(x + largura, doc.y).lineWidth(espessura).strokeColor(cor).stroke().restore();
}

function desenharTabela(doc, bloco, esquerda, larguraTotal) {
    const PAD = 4;
    const TAM_FONTE = 8.5;
    const somaProporcoes = bloco.colunas.reduce((s, c) => s + (c.largura ?? 1), 0);
    const larguras = bloco.colunas.map((c) => ((c.largura ?? 1) / somaProporcoes) * larguraTotal);
    const limiteInferior = () => doc.page.height - doc.page.margins.bottom;

    const alturaLinha = (celulas, fonte) => {
        doc.font(fonte).fontSize(TAM_FONTE);
        return Math.max(...celulas.map((t, i) =>
            doc.heightOfString(String(t ?? ''), { width: larguras[i] - PAD * 2 }))) + PAD * 2;
    };

    const desenharLinha = (celulas, { fonte = 'Helvetica', fundo, cor = COR_TEXTO } = {}) => {
        const altura = alturaLinha(celulas, fonte);
        if (doc.y + altura > limiteInferior()) {
            doc.addPage();
            if (!fundo) desenharCabecalho(); // repete o cabeçalho da tabela na nova página
        }
        const y = doc.y;
        if (fundo) doc.save().rect(esquerda, y, larguraTotal, altura).fill(fundo).restore();
        let x = esquerda;
        celulas.forEach((t, i) => {
            doc.font(fonte).fontSize(TAM_FONTE).fillColor(cor).text(String(t ?? ''), x + PAD, y + PAD, {
                width: larguras[i] - PAD * 2,
                align: bloco.colunas[i].alinhar ?? 'left',
            });
            x += larguras[i];
        });
        doc.y = y + altura;
        doc.x = esquerda;
        linhaHorizontal(doc, esquerda, larguraTotal);
    };

    const desenharCabecalho = () => desenharLinha(bloco.colunas.map((c) => c.titulo.toUpperCase()), {
        fonte: 'Helvetica-Bold', fundo: COR_FUNDO_CABECALHO, cor: '#555555',
    });

    if (bloco.titulo) {
        if (doc.y + 60 > limiteInferior()) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(12).fillColor(COR_PRINCIPAL).text(bloco.titulo, esquerda, doc.y);
        doc.moveDown(0.4);
    }

    if (!bloco.linhas.length) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(COR_SECUNDARIA)
            .text(bloco.vazio ?? 'Nenhum registro no período.', esquerda, doc.y);
        return;
    }

    desenharCabecalho();
    for (const linha of bloco.linhas) desenharLinha(linha);
    if (bloco.totais) desenharLinha(bloco.totais, { fonte: 'Helvetica-Bold', fundo: '#E3EBE5' });
}
