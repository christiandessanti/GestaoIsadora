/** Testes de unidade: validações e cálculos (não usam banco nem servidor). */
import { ok, secao, finalizar } from '../auxiliares.mjs';

// validacao.js importa erros.js, que não depende de banco.
const v = await import('../../src/utils/validacao.js');
const { calcularSubtotalCentavos } = await import('../../src/services/vendas.js');

const lanca = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

secao('Quantidade');
ok('"12,5" kg -> "12.5"', v.quantidade('12,5', 'kg') === '12.5');
ok('"5.000" cx -> "5" (zeros à direita)', v.quantidade('5.000', 'cx') === '5');
ok('2 casas decimais recusado', lanca(() => v.quantidade('1,25', 'kg'))?.includes('1 casa decimal'));
ok('decimal em "un" recusado', lanca(() => v.quantidade('2,5', 'un'))?.includes('inteiro'));
ok('negativo recusado', lanca(() => v.quantidade('-1', 'kg')) === 'Quantidade não pode ser negativa.');
ok('zero recusado', lanca(() => v.quantidade('0', 'kg'))?.includes('maior que zero'));
ok('zero permitido quando indicado', v.quantidade('0', 'kg', { permitirZero: true }) === '0');

secao('Dinheiro');
ok('"1.234,56" -> "1234.56"', v.dinheiro('1.234,56') === '1234.56');
ok('"2600" -> "2600.00"', v.dinheiro('2600') === '2600.00');
ok('"19.99" -> "19.99"', v.dinheiro('19.99') === '19.99');
ok('3 casas recusado', Boolean(lanca(() => v.dinheiro('1,005'))));
ok('negativo recusado', lanca(() => v.dinheiro('-3')) === 'Valor não pode ser negativo.');
ok('texto recusado', Boolean(lanca(() => v.dinheiro('abc'))));

secao('Datas e outros');
ok('data válida', v.data('2026-02-28') === '2026-02-28');
ok('30 de fevereiro recusado', Boolean(lanca(() => v.data('2026-02-30'))));
ok('formato brasileiro recusado', Boolean(lanca(() => v.data('10/10/2026'))));
ok('telefone vazio -> null', v.telefone('') === null);
ok('telefone inválido recusado', Boolean(lanca(() => v.telefone('abc'))));
ok('texto: espaços normalizados', v.texto('  João   da  Silva ', 'o nome') === 'João da Silva');
ok('senha: confirmação diferente', lanca(() => v.novaSenha('12345678', '87654321'))?.includes('confirmação'));

secao('Cálculo de subtotal (centavos, sem erro de arredondamento)');
ok('10 × 12,50 = 12500 centavos (R$ 125,00)', calcularSubtotalCentavos('10', '12.50') === 12500n);
ok('2,5 × 19,99 = 4998 centavos (49,975 arredonda para cima)', calcularSubtotalCentavos('2.5', '19.99') === 4998n);
ok('0,1 × 0,10 = 1 centavo', calcularSubtotalCentavos('0.1', '0.10') === 1n);
ok('3 × 0,1 = 30 centavos (sem 0,30000000000000004)', calcularSubtotalCentavos('3', '0.1') === 30n);

finalizar();
