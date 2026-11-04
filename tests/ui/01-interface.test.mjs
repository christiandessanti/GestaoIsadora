/**
 * Testes da interface no navegador (Google Chrome, sem janela).
 * Executado apenas com "npm run test:ui".
 * Caminho do Chrome: variável CHROME_PATH (padrão: /usr/bin/google-chrome).
 * Para salvar capturas de tela, defina CAPTURAS=/caminho/da/pasta.
 */
import puppeteer from 'puppeteer-core';
import { URL_BASE as B, sessao, ok, secao, finalizar } from '../auxiliares.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const CAPTURAS = process.env.CAPTURAS;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const texto = (t) => t.replace(/ /g, ' '); // o formato de moeda usa espaço não separável

// ---------- Dados de apoio
const ger = await sessao('gerente');
const cli = (await ger('POST', '/api/clientes', { nome: 'Mercado Teste', telefone: '(11) 98888-7777' })).d;
const pA = (await ger('POST', '/api/produtos-venda', { nome: 'Biscoito Caixa', unidade: 'cx' })).d;
const pB = (await ger('POST', '/api/produtos-venda', { nome: 'Biscoito Granel', unidade: 'kg' })).d;
await ger('POST', '/api/materias-primas', { nome: 'Farinha Teste', unidade: 'kg', estoqueInicial: '50' });

const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--lang=pt-BR'] });
const page = await navegador.newPage();
const erros = [];
page.on('pageerror', (e) => erros.push(`[JS] ${page.url()} ${e.message}`));
page.on('response', (r) => {
    const esperado = r.status() === 409 || r.url().includes('/api/auth/me');
    if (r.status() >= 400 && !esperado) erros.push(`[HTTP ${r.status()}] ${r.url()}`);
});
await page.setViewport({ width: 1366, height: 900 });
const foto = (nome) => CAPTURAS && page.screenshot({ path: `${CAPTURAS}/${nome}.png`, fullPage: true });
const ir = async (p) => { await page.goto(B + p, { waitUntil: 'networkidle0' }); await espera(300); };
const cancelarModal = async () => {
    await page.$$eval('dialog button', (bs) => bs.find((b) => b.textContent === 'Cancelar').click());
    await espera(300);
};

try {
    secao('Login');
    await ir('/');
    await page.type('#usuario', 'zzt_ger');
    ok('usuário exibido em maiúsculas', (await page.$eval('#usuario', (e) => e.value)) === 'ZZT_GER');
    await page.type('#senha', 'senha-ger-1234');
    await page.click('#mostrar-senha');
    ok('botão mostrar senha', (await page.$eval('#senha', (e) => e.type)) === 'text');
    await foto('01-login');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type=submit]')]);
    ok('redireciona para o início', page.url().endsWith('/main'));
    ok('nome do usuário no cabeçalho', (await page.$eval('#usuario-nome', (e) => e.textContent)) === 'Teste gerente');

    secao('Estoque');
    await ir('/estoque');
    const abrirProduto = async (nome) => {
        for (const l of await page.$$('.link-produto')) {
            if ((await l.evaluate((e) => e.textContent)) === nome) { await l.click(); await espera(250); return true; }
        }
        return false;
    };
    ok('produto aparece na lista', await abrirProduto('Farinha Teste'));
    await page.type('dialog input[name=quantidade]', '12,5');
    await page.type('dialog textarea[name=observacao]', 'Teste pelo navegador');
    await page.click('dialog button[value=entrada]'); await espera(800);
    const linha = await page.$$eval('.tabela tbody tr', (trs) => trs.map((t) => t.innerText).find((t) => t.includes('Farinha Teste')));
    ok('entrada atualiza para 62,5 kg', linha?.includes('62,5 kg') && linha.includes('Entrada +12,5 kg'));
    await abrirProduto('Farinha Teste');
    await page.type('dialog input[name=quantidade]', '999');
    await page.click('dialog button[value=saida]'); await espera(500);
    ok('saída acima do estoque mostra erro', (await page.$eval('dialog .form-erro', (e) => e.textContent)).includes('Estoque insuficiente'));
    await cancelarModal();
    await page.click('#form-relatorio button[type=submit]'); await espera(800);
    ok('relatório gerado', (await page.$$('#resultado-relatorio table')).length === 2);
    await foto('02-estoque');

    secao('Vendas');
    await ir('/vendas');
    const preencherVenda = async (comPrecos) => {
        await page.click('#nova-venda'); await page.waitForSelector('dialog #venda-cliente'); await espera(200);
        await page.select('#venda-cliente', String(cli.id)); await espera(500);
        await page.select('.item-venda select', String(pA.id)); await espera(200);
        const [qtd, preco] = await page.$$('.item-venda input');
        await qtd.type('10');
        if (comPrecos) await preco.type('12,50');
        await page.click('.botao-adicionar'); await espera(200);
        const linhas = await page.$$('.item-venda');
        await (await linhas[1].$('select')).select(String(pB.id));
        const [q2, p2] = await linhas[1].$$('input');
        await q2.type('2,5');
        if (comPrecos) await p2.type('19,99');
        await espera(200);
    };
    await preencherVenda(true);
    const total = texto(await page.$eval('.venda-total strong', (e) => e.textContent));
    ok('total na tela igual ao do servidor (R$ 174,98)', total === 'R$ 174,98', total);
    await foto('03-venda-modal');
    await page.click('dialog button[type=submit]'); await espera(1000);
    ok('venda aparece na lista', (await page.$eval('#lista-vendas', (e) => e.innerText)).includes('Mercado Teste'));
    await preencherVenda(false);
    const precos = await page.$$eval('.item-venda input', (ins) => ins.map((i) => i.value));
    ok('2ª venda sugere os últimos preços', precos[1] === '12,50' && precos[3] === '19,99', JSON.stringify(precos));
    ok('preços sugeridos destacados', (await page.$$('.item-venda input.preco-sugerido')).length === 2);
    await cancelarModal();
    await page.click('#lista-vendas .col-acoes button'); await page.waitForSelector('dialog #venda-cliente'); await espera(500);
    ok('edição carrega os 2 itens', (await page.$$('.item-venda')).length === 2);
    await cancelarModal();
    await page.click('#form-relatorio button[type=submit]'); await espera(800);
    ok('relatório de vendas gerado', (await page.$$('#resultado-relatorio .resumo-card')).length === 5);

    secao('Despesas');
    await ir('/despesas');
    await page.click('#nova-despesa'); await page.waitForSelector('dialog select[name=categoriaId]');
    const optLuz = await page.$$eval('dialog select[name=categoriaId] option', (os) => os.find((o) => o.textContent === 'Luz').value);
    await page.select('dialog select[name=categoriaId]', optLuz);
    await page.type('dialog input[name=valor]', '345,67');
    await page.click('dialog button[type=submit]'); await espera(800);
    ok('despesa aparece na lista', texto(await page.$eval('#lista-despesas', (e) => e.innerText)).includes('R$ 345,67'));

    secao('DRE, Configurações e Início');
    await ir('/dre'); await espera(800);
    ok('DRE exibido ao abrir a página', (await page.$$('.dre-resultado')).length === 1);
    await foto('04-dre');
    await ir('/configuracoes');
    const abas = await page.$$('.config-abas .aba');
    ok('gerente vê 7 abas', abas.length === 7);
    for (const a of abas) if ((await a.evaluate((e) => e.textContent)) === 'Clientes') await a.click();
    await espera(500);
    const visiveis = await page.$$eval('main > section.cartao', (ss) => ss.filter((s) => !s.hidden).map((s) => s.id));
    ok('só a aba escolhida fica visível', visiveis.length === 1 && visiveis[0] === 'secao-clientes');
    await ir('/main');
    ok('início mostra a venda e o estoque', texto(await page.$eval('main', (e) => e.innerText)).includes('R$ 174,98')
        && (await page.$eval('main', (e) => e.innerText)).includes('Farinha Teste'));
    await foto('05-inicio');

    secao('Celular');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await ir('/vendas');
    ok('barra inferior visível', await page.$eval('.barra-inferior', (e) => getComputedStyle(e).display !== 'none'));
    ok('menu lateral escondido', await page.$eval('aside', (e) => getComputedStyle(e).display === 'none'));
    ok('relatório escondido', await page.$eval('#secao-relatorio', (e) => getComputedStyle(e).display === 'none'));
    await foto('06-celular-vendas');
    await ir('/dre');
    ok('DRE indisponível no celular', await page.$eval('main .cartao', (e) => getComputedStyle(e).display === 'none'));

    secao('Sair');
    await page.setViewport({ width: 1366, height: 900 });
    await ir('/main');
    await Promise.all([page.waitForNavigation(), page.click('#botao-sair')]);
    await ir('/vendas');
    ok('após sair, volta para o login', new URL(page.url()).pathname === '/');
} finally {
    await navegador.close();
}

ok('nenhum erro de JavaScript ou de rede inesperado', erros.length === 0, erros.join(' | '));
finalizar();
