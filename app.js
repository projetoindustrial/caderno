// HydroCalc — lógica de cálculo hidráulico (portada de Python/openpyxl)
// Todas as contas rodam no cliente — funciona 100% offline.

const G = 9.81;

// Painel: estado dos últimos resultados de cada módulo. Precisa ser declarado
// aqui no topo (não perto de renderDashboard/irParaModulo, onde estava antes)
// porque módulos como PSV chamam sua função update() de forma IMEDIATA no
// carregamento da página (ex.: updatePsv() logo após a definição), e essas
// funções escrevem em DASH.<modulo> — se DASH ainda não existisse nesse
// ponto da execução, o `const DASH` mais abaixo travava o script inteiro
// (TDZ: "Cannot access 'DASH' before initialization"), o que por sua vez
// impedia até o listener de clique das abas de ser registrado (Achado F4,
// corrigido nesta sessão — bug pré-existente, não introduzido por este
// sprint, só descoberto ao validar em navegador real em vez de só
// node --check).
const DASH = {};

// Dado CRU por módulo, companheiro de DASH (que só guarda string de exibição
// pronta pra tabela — ver Achado, ESCOPO_ponte-hydrocalc-motor-novo_2026-09-11.md).
// Populado só pelos módulos que já têm handoff pra Planta Virtual especificado
// (hoje: torre de resfriamento — prova de conceito, 2026-09-11). Mesmo motivo
// de DASH estar aqui no topo: módulos podem escrever nele antes do resto do
// script rodar.
const DASH_RAW = {};

// Handoff Planta Virtual -> HydroCalc (2026-09-11, prova de conceito só com a
// torre): se a página foi aberta com ?modulo=X&retorno=1, navega direto pro
// módulo X e habilita o botão "Usar na Planta Virtual" daquele módulo. Lido
// aqui, no topo, mas só executado depois que o DOM carrega (ver
// DOMContentLoaded no fim do arquivo) porque irParaModulo() clica num
// elemento que ainda não existe neste ponto do script.
const _params = new URLSearchParams(window.location.search);
const HANDOFF_MODULO = _params.get("modulo");
const HANDOFF_RETORNO = _params.get("retorno") === "1";

const RUGOSIDADE = {
  "PVC / PPR (novo)": 0.0000015,
  "Cobre": 0.0000015,
  "Aço galvanizado (novo)": 0.00015,
  "Aço galvanizado (usado)": 0.0005,
  "Ferro fundido (novo)": 0.00026,
  "Ferro fundido (usado)": 0.0015,
  "Concreto": 0.0003,
  // Materiais do catálogo da planilha (aba "Fluidos e Tubos", named range MATERIAIS_RUG) —
  // adicionados no Sprint N1b pra unificar com o catálogo do PWA. Valores convertidos de
  // mm (fonte: MATERIAIS_RUG) para m, mesma unidade das entradas acima. Materiais distintos
  // dos já existentes: "Aço Carbono Sch 40" não é o mesmo que "Aço galvanizado", "Ferro
  // Fundido Dúctil" não é o mesmo que "Ferro fundido" genérico — por isso entram como
  // materiais novos, não substituem os existentes.
  "PVC Soldável": 0.0000015,
  "Aço Carbono Sch 40": 0.000045,
  "Ferro Fundido Dúctil": 0.00012,
  "PEAD PE100": 0.000007,
};

const C_HAZEN = {
  "PVC / PPR": 150,
  "Cobre": 140,
  "Aço galvanizado (novo)": 120,
  "Aço galvanizado (usado)": 100,
  "Ferro fundido (novo)": 130,
  "Ferro fundido (usado)": 90,
  "Concreto": 120,
};

const K_CONEXOES = {
  "Cotovelo 90°": 0.9,
  "Cotovelo 45°": 0.4,
  "Tê (passagem direta)": 0.6,
  "Tê (derivação)": 1.8,
  "Válvula gaveta (aberta)": 0.2,
  "Válvula globo (aberta)": 10.0,
  "Válvula de retenção": 2.5,
  "Entrada normal": 0.5,
  "Saída de tubulação": 1.0,
  "Redução gradual": 0.15,
};

// Fluidos petroquímicos: densidade (kg/m³) e viscosidade (cP), referência ~20°C
const FLUIDOS_PETROQ = {
  "Água": { rho: 998, mu: 1.00 },
  "Água do mar": { rho: 1025, mu: 1.08 },
  "Diesel S10": { rho: 840, mu: 3.5 },
  "Gasolina": { rho: 740, mu: 0.5 },
  "Nafta": { rho: 700, mu: 0.4 },
  "Etanol": { rho: 789, mu: 1.2 },
  "Metanol": { rho: 792, mu: 0.59 },
  "Óleo cru leve (~35 °API)": { rho: 850, mu: 8 },
  "Óleo cru pesado (~20 °API)": { rho: 920, mu: 200 },
  "Óleo lubrificante (ISO VG 68)": { rho: 880, mu: 68 },
  "Soda cáustica 50%": { rho: 1525, mu: 79 },
  "Amônia líquida": { rho: 610, mu: 0.13 },
  "Personalizado": { rho: 1000, mu: 1 },
};

// Gases: massa molar (kg/kmol), viscosidade (cP) e razão de calores específicos k=Cp/Cv, referência ~20°C
const GASES = {
  "Ar": { m: 28.97, mu: 0.018, k: 1.40 },
  "Metano (CH4)": { m: 16.04, mu: 0.011, k: 1.32 },
  "Gás natural (típico)": { m: 19.0, mu: 0.011, k: 1.27 },
  "Propano (C3H8)": { m: 44.10, mu: 0.008, k: 1.13 },
  "GLP vapor": { m: 50.0, mu: 0.0075, k: 1.13 },
  "Nitrogênio": { m: 28.01, mu: 0.0176, k: 1.40 },
  "Hidrogênio": { m: 2.016, mu: 0.0088, k: 1.41 },
  "CO2": { m: 44.01, mu: 0.0147, k: 1.29 },
  "Vapor d'água": { m: 18.02, mu: 0.012, k: 1.33 },
  "Personalizado": { m: 29, mu: 0.018, k: 1.4 },
};
const R_UNIV = 8314; // J/(kmol.K)

// Materiais de referência ASME B31.3 — tensão admissível S a temperatura ambiente (MPa), confirmar por tabela do código
const MATERIAIS_B31_3 = {
  "A106 Gr.B (aço carbono)": 137.9,
  "A312 TP304/304L (inox)": 115.0,
  "A312 TP316/316L (inox)": 115.0,
  "A333 Gr.6 (baixa temperatura)": 137.9,
  "Personalizado": 137.9,
};

// Orifícios padrão API 526 (mm²), da menor para a maior
const ORIFICIOS_API526 = [
  ["D", 70.97], ["E", 126.45], ["F", 198.06], ["G", 324.51], ["H", 506.45],
  ["J", 830.32], ["K", 1186.10], ["L", 1840.86], ["M", 2322.58], ["N", 2799.99],
  ["P", 4116.10], ["Q", 7129.02], ["R", 10322.58], ["T", 16774.16],
];

// Diâmetros comerciais de referência (mm) — para arredondar o diâmetro econômico
const DIAMETROS_COMERCIAIS_MM = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500];

// Ventosas e VAP — série comercial de orifícios de purga contínua (mm) e bitolas de ventosa/VAP (mm)
const ORIFICIOS_COMERCIAIS_VENTOSA = [3, 5, 8, 13, 20, 25, 32, 40, 50];
const BITOLAS_VAP = [25, 32, 40, 50, 65, 80, 100, 125, 150];

// Transientes (golpe de aríete) — catálogo de tubos: di/e em mm, E (módulo de elasticidade) em GPa, pn (mca)
const K_AGUA_PA = 2_190_000_000; // 2,19 GPa em Pa
const TUBOS_TRANSIENTES = {
  "PVC Soldável - 20 mm (1/2\")": { material: "PVC Soldável", di: 17, e: 1.5, E: 3, pn: 100 },
  "PVC Soldável - 25 mm (3/4\")": { material: "PVC Soldável", di: 21.2, e: 1.9, E: 3, pn: 100 },
  "PVC Soldável - 32 mm (1\")": { material: "PVC Soldável", di: 27.2, e: 2.4, E: 3, pn: 100 },
  "PVC Soldável - 50 mm (1.1/2\")": { material: "PVC Soldável", di: 42.6, e: 3.7, E: 3, pn: 100 },
  "PVC Soldável - 60 mm (2\")": { material: "PVC Soldável", di: 51.2, e: 4.4, E: 3, pn: 100 },
  "PVC Soldável - 110 mm (4\")": { material: "PVC Soldável", di: 93.8, e: 8.1, E: 3, pn: 100 },
  "Aço Carbono Sch 40 - 2\" Sch 40": { material: "Aço Carbono Sch 40", di: 52.51, e: 3.91, E: 210, pn: 250 },
  "Aço Carbono Sch 40 - 3\" Sch 40": { material: "Aço Carbono Sch 40", di: 77.92, e: 5.49, E: 210, pn: 250 },
  "Aço Carbono Sch 40 - 4\" Sch 40": { material: "Aço Carbono Sch 40", di: 102.26, e: 6.02, E: 210, pn: 250 },
  "Aço Carbono Sch 40 - 6\" Sch 40": { material: "Aço Carbono Sch 40", di: 154.06, e: 7.11, E: 210, pn: 250 },
  "Ferro Fundido Dúctil - DN 100 K9": { material: "Ferro Fundido Dúctil", di: 106, e: 6, E: 170, pn: 400 },
  "Ferro Fundido Dúctil - DN 150 K9": { material: "Ferro Fundido Dúctil", di: 158, e: 6, E: 170, pn: 400 },
  "PEAD PE100 - 63 mm": { material: "PEAD PE100", di: 51.4, e: 5.8, E: 1, pn: 100 },
  "PEAD PE100 - 110 mm": { material: "PEAD PE100", di: 90, e: 10, E: 1, pn: 100 },
};

// Materiais de referência ASME VIII Div.1 — tensão admissível S a temperatura ambiente (MPa),
// confirmar por ASME Section II-D Tabelas 1A/1B na temperatura real de projeto
const MATERIAIS_ASME_VIII = {
  "SA-516 Gr.70 (aço carbono, chapa)": 137.9,
  "SA-106 Gr.B (aço carbono, tubo)": 118.6,
  "SA-240 304/304L (inox)": 129.6,
  "SA-240 316/316L (inox)": 129.6,
  "Personalizado": 137.9,
};

// Espaçamento entre pratos: coeficiente Csb típico (Souders-Brown, m/s) — valor de referência
// a baixo FLV; ajustar pela correlação completa de Fair para o sistema real
const ESPACAMENTO_PRATOS = {
  "300 mm (12\")": 0.09,
  "450 mm (18\")": 0.11,
  "600 mm (24\")": 0.13,
  "900 mm (36\")": 0.15,
};

// ---------------------------------------------------------------------------
// Propriedades de vapor saturado — IAPWS-IF97 (Regiões 1, 2 e 4)
// Formulação industrial padrão (não é mais tabela + interpolação linear).
// Válida 0,0006112 a 22,064 MPa / 273,15 a 647,096 K — cobre toda a faixa
// de pressão de vapor industrial (~0,006 a 220 bar).
// Coeficientes conferidos contra o pacote de referência `iapws` (Python)
// linha a linha antes de aplicar — ver validar_f6.py.
// ---------------------------------------------------------------------------
const IF97_R = 0.461526; // kJ/(kg·K)

// Região 4 — curva de saturação (Eq. 29a/29b da IAPWS-IF97)
const IF97_N4 = [
  0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2,
  0.12020824702470e5, -0.32325550322333e7, 0.14915108613530e2,
  -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849,
  0.65017534844798e3,
];

function if97TsatK(pMPa) {
  const n = IF97_N4;
  const beta = Math.pow(pMPa, 0.25);
  const E = beta * beta + n[2] * beta + n[5];
  const F = n[0] * beta * beta + n[3] * beta + n[6];
  const G = n[1] * beta * beta + n[4] * beta + n[7];
  const D = (2 * G) / (-F - Math.sqrt(F * F - 4 * E * G));
  return (n[9] + D - Math.sqrt((n[9] + D) ** 2 - 4 * (n[8] + n[9] * D))) / 2;
}

// Região 1 — líquido saturado (34 termos, Eq. 7 da IAPWS-IF97)
const IF97_R1_I = [0,0,0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,8,8,21,23,29,30,31,32];
const IF97_R1_J = [-2,-1,0,1,2,3,4,5,-9,-7,-1,0,1,3,-3,0,1,3,17,-4,0,6,-5,-2,10,-8,-11,-6,-29,-31,-38,-39,-40,-41];
const IF97_R1_N = [0.1463297121,-0.8454818717,-3.756360367,3.385516917,-0.9579196339,0.1577203851,-0.0166164172,0.0008121462998,0.0002831908012,-0.0006070630157,-0.01899006822,-0.03252974877,-0.02184171718,-5.283835797e-05,-0.0004718432107,-0.0003000178079,4.766139391e-05,-4.414184533e-06,-7.26949963e-16,-3.167964485e-05,-2.827079799e-06,-8.520512812e-10,-2.242528191e-06,-6.51712229e-07,-1.434172994e-13,-4.051699686e-07,-1.273430174e-09,-1.742487123e-10,-6.87621313e-19,1.447830783e-20,2.633578166e-23,-1.194762264e-23,1.822809458e-24,-9.353708729e-26];

// h do líquido saturado (kJ/kg), a partir de T (K) e P (MPa)
function if97Region1_h(tK, pMPa) {
  const pr = pMPa / 16.53;
  const tr = 1386 / tK;
  let gt = 0;
  for (let k = 0; k < IF97_R1_N.length; k++) {
    gt += IF97_R1_N[k] * IF97_R1_J[k] * Math.pow(7.1 - pr, IF97_R1_I[k]) * Math.pow(tr - 1.222, IF97_R1_J[k] - 1);
  }
  return tr * gt * IF97_R * tK;
}

// Região 2 — vapor saturado (parte ideal, 9 termos + residual, 43 termos, Eq. 15-17)
const IF97_R2_J0 = [0,1,-5,-4,-3,-2,-1,2,3];
const IF97_R2_N0 = [-9.69276865,10.08665597,-0.005608791128,0.07145273808,-0.4071049822,1.424081917,-4.383951132,-0.2840863246,0.02126846375];
const IF97_R2_I = [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3,4,4,4,5,6,6,6,7,7,7,8,8,9,10,10,10,16,16,18,20,20,20,21,22,23,24,24,24];
const IF97_R2_J = [0,1,2,3,6,1,2,4,7,36,0,1,3,6,35,1,2,3,7,3,16,35,0,11,25,8,36,13,4,10,14,29,50,57,20,35,48,21,53,39,26,40,58];
const IF97_R2_N = [-0.001773174247,-0.01783486229,-0.0459960137,-0.05758125908,-0.05032527873,-3.303264167e-05,-0.0001894898752,-0.003939277724,-0.04379729565,-2.667454791e-05,2.048173769e-08,4.387066728e-07,-3.227767724e-05,-0.001503392454,-0.04066825356,-7.884730956e-10,1.279071785e-08,4.822537272e-07,2.292207634e-06,-1.671476645e-11,-0.002117147232,-23.89574193,-5.905956432e-18,-1.26218089e-06,-0.03894684244,1.125621136e-11,-8.23113409,1.98097128e-08,1.040696521e-19,-1.02347471e-13,-1.001817938e-09,-8.088290865e-11,0.1069303188,-0.3366225057,8.918584536e-25,3.062931688e-13,-4.20024677e-06,-5.905602969e-26,3.782694761e-06,-1.276860893e-15,7.30876106e-29,5.541471535e-17,-9.436970724e-07];

// h e v do vapor saturado (kJ/kg, m³/kg), a partir de T (K) e P (MPa)
function if97Region2_hv(tK, pMPa) {
  const pr = pMPa;
  const tr = 540 / tK;
  let got = 0;
  for (let k = 0; k < IF97_R2_N0.length; k++) {
    got += IF97_R2_N0[k] * IF97_R2_J0[k] * Math.pow(tr, IF97_R2_J0[k] - 1);
  }
  let grp = 0, grt = 0;
  for (let k = 0; k < IF97_R2_N.length; k++) {
    const i = IF97_R2_I[k], j = IF97_R2_J[k], n = IF97_R2_N[k];
    grp += n * i * Math.pow(pr, i - 1) * Math.pow(tr - 0.5, j);
    grt += n * j * Math.pow(pr, i) * Math.pow(tr - 0.5, j - 1);
  }
  const gop = 1 / pr;
  const h = tr * (got + grt) * IF97_R * tK;
  const v = (pr * (gop + grp) * IF97_R * tK) / pMPa / 1000;
  return [h, v];
}

// Substitui a antiga TABELA_VAPOR_SATURADO + interpolação linear.
// Mesma assinatura/retorno de antes: [tsat_C, hf, hfg, hg, vg].
function vaporSaturadoInterp(pBar) {
  const pMPa = Math.max(0.0006112, Math.min(22.06, pBar / 10));
  const tK = if97TsatK(pMPa);
  const hf = if97Region1_h(tK, pMPa);
  const [hg, vg] = if97Region2_hv(tK, pMPa);
  return [tK - 273.15, hf, hg - hf, hg, vg];
}

// Coeficientes de Siegert (perda pelos gases de combustão, base %O2) por combustível
const COMBUSTIVEIS_SIEGERT = {
  "Gás natural": { A2: 0.66, B: 0.009 },
  "GLP": { A2: 0.63, B: 0.008 },
  "Óleo combustível (BPF)": { A2: 0.68, B: 0.007 },
  "Diesel": { A2: 0.67, B: 0.007 },
  "Carvão": { A2: 0.82, B: 0.010 },
};

// Coeficiente de dilatação térmica linear típico (mm/m por °C), referência ambiente-moderado
const MATERIAIS_DILATACAO = {
  "Aço carbono": 0.012,
  "Aço inox 304/316": 0.017,
  "Alumínio": 0.023,
  "Cobre": 0.017,
  "PVC": 0.070,
  "Personalizado": 0.012,
};

// Condutividade térmica típica de isolantes industriais (W/m·K)
const ISOLANTES = {
  "Lã de rocha/mineral": 0.040,
  "Lã de vidro": 0.038,
  "Silicato de cálcio": 0.060,
  "Espuma elastomérica": 0.035,
  "Aerogel": 0.020,
  "Personalizado": 0.040,
};

// Coeficiente K (perda de carga tipo ΣK) de referência por tipo de filtro/coador —
// valor típico de ordem de grandeza; confirmar com a curva do fabricante
const FILTROS_K = {
  "Tela simples/malha grossa": 0.8,
  "Cesto (basket strainer)": 1.5,
  "Y-strainer": 2.0,
  "Cartucho": 3.5,
  "Saco (bag filter)": 4.5,
  "Personalizado": 1.5,
};

// Compatibilidade material x fluido — orientação geral de triagem, NÃO substitui
// avaliação de um engenheiro de materiais/corrosão para o serviço real (concentração,
// temperatura, velocidade) nem normas aplicáveis (ex.: NACE MR0175/ISO 15156 p/ sour)
const COMPATIBILIDADE = {
  "Água doce (ambiente)": {
    "Aço carbono": ["Boa", "Corrosão geral lenta; considerar revestimento/CA em serviço prolongado."],
    "Aço inox 304/304L": ["Excelente", "Sem restrições em água doce típica."],
    "Aço inox 316/316L": ["Excelente", "Sem restrições."],
    "Monel 400": ["Excelente", "Uso comum em água doce e do mar."],
    "Hastelloy C-276": ["Excelente", "Sobre-especificado para este serviço, mas compatível."],
    "PVC": ["Excelente", "Amplamente usado em água fria."],
    "PTFE (Teflon)": ["Excelente", "Inerte."],
    "Titânio": ["Excelente", "Sobre-especificado, mas compatível."],
  },
  "Água do mar / salmoura (cloretos)": {
    "Aço carbono": ["Não recomendado", "Corrosão acelerada por cloretos; requer revestimento robusto ou proteção catódica."],
    "Aço inox 304/304L": ["Não recomendado", "Suscetível a pite e corrosão sob tensão por cloretos."],
    "Aço inox 316/316L": ["Regular — avaliar", "Melhor que 304, mas ainda vulnerável a pite em água estagnada/quente."],
    "Monel 400": ["Excelente", "Referência clássica para água do mar."],
    "Hastelloy C-276": ["Excelente", "Excelente resistência a cloretos."],
    "PVC": ["Excelente", "Inerte a cloretos."],
    "PTFE (Teflon)": ["Excelente", "Inerte."],
    "Titânio": ["Excelente", "Referência para água do mar em condições oxidantes."],
  },
  "Vapor d'água": {
    "Aço carbono": ["Boa", "Padrão da indústria; atenção a erosão-corrosão em alta velocidade/baixo pH."],
    "Aço inox 304/304L": ["Excelente", "Uso comum em linhas de vapor limpo."],
    "Aço inox 316/316L": ["Excelente", "Sem restrições."],
    "Monel 400": ["Boa", "Compatível, raramente necessário."],
    "Hastelloy C-276": ["Excelente", "Sobre-especificado."],
    "PVC": ["Não recomendado", "Temperatura excede o limite do material."],
    "PTFE (Teflon)": ["Regular — avaliar", "Limite de temperatura próximo do vapor saturado em baixa pressão."],
    "Titânio": ["Boa", "Compatível."],
  },
  "Ácido sulfúrico diluído (<10%)": {
    "Aço carbono": ["Não recomendado", "Corrosão rápida — a passivação do aço carbono só ocorre em concentração alta."],
    "Aço inox 304/304L": ["Regular — avaliar", "Resistência limitada; depende de temperatura."],
    "Aço inox 316/316L": ["Regular — avaliar", "Melhor que 304, ainda limitado em diluído."],
    "Monel 400": ["Regular — avaliar", "Resistência moderada, depende de aeração."],
    "Hastelloy C-276": ["Excelente", "Referência para ácido sulfúrico em ampla faixa."],
    "PVC": ["Boa", "Resistente em temperatura ambiente."],
    "PTFE (Teflon)": ["Excelente", "Inerte na maioria das concentrações/temperaturas."],
    "Titânio": ["Não recomendado", "Sofre corrosão em meio redutor não oxidante como H2SO4 diluído."],
  },
  "Ácido sulfúrico concentrado (>90%)": {
    "Aço carbono": ["Boa", "Passivação por filme de sulfato em concentração alta e baixa velocidade — não válido para diluído nem alta velocidade."],
    "Aço inox 304/304L": ["Regular — avaliar", "Pode sofrer corrosão em pontos de aeração/diluição local."],
    "Aço inox 316/316L": ["Boa", "Melhor que 304 em concentrado."],
    "Monel 400": ["Não recomendado", "Não indicado em concentrado quente."],
    "Hastelloy C-276": ["Excelente", "Referência para ampla faixa de concentração."],
    "PVC": ["Não recomendado", "Ataque em concentração alta."],
    "PTFE (Teflon)": ["Excelente", "Inerte."],
    "Titânio": ["Não recomendado", "Meio redutor não oxidante ataca titânio."],
  },
  "Ácido clorídrico (qualquer concentração)": {
    "Aço carbono": ["Não recomendado", "Corrosão severa em qualquer concentração."],
    "Aço inox 304/304L": ["Não recomendado", "Cloretos atacam mesmo em baixa concentração."],
    "Aço inox 316/316L": ["Não recomendado", "Resistência insuficiente para HCl."],
    "Monel 400": ["Regular — avaliar", "Uso limitado, depende de aeração e temperatura."],
    "Hastelloy C-276": ["Excelente", "Referência clássica para HCl quente/concentrado."],
    "PVC": ["Boa", "Resistente em temperatura ambiente/moderada."],
    "PTFE (Teflon)": ["Excelente", "Inerte em praticamente toda faixa."],
    "Titânio": ["Não recomendado", "Ataque severo mesmo em baixa concentração."],
  },
  "Soda cáustica (NaOH)": {
    "Aço carbono": ["Boa", "Uso comum até temperatura moderada; atenção a fragilização cáustica acima de ~70-80°C."],
    "Aço inox 304/304L": ["Boa", "Compatível na maioria das condições."],
    "Aço inox 316/316L": ["Excelente", "Compatível em ampla faixa."],
    "Monel 400": ["Excelente", "Referência clássica para soda cáustica quente/concentrada."],
    "Hastelloy C-276": ["Excelente", "Compatível, sobre-especificado para uso comum."],
    "PVC": ["Boa", "Resistente até temperatura moderada."],
    "PTFE (Teflon)": ["Excelente", "Inerte."],
    "Titânio": ["Não recomendado", "Pode sofrer fragilização por hidrogênio em cáustico quente."],
  },
  "Amônia anidra": {
    "Aço carbono": ["Boa", "Padrão da indústria; evitar cobre e ligas de cobre (não listadas aqui) que reagem com amônia."],
    "Aço inox 304/304L": ["Excelente", "Compatível."],
    "Aço inox 316/316L": ["Excelente", "Compatível."],
    "Monel 400": ["Regular — avaliar", "Ligas de cobre-níquel podem ser atacadas por amônia úmida."],
    "Hastelloy C-276": ["Excelente", "Compatível, sobre-especificado."],
    "PVC": ["Regular — avaliar", "Depende de temperatura/pressão; confirmar com fabricante."],
    "PTFE (Teflon)": ["Excelente", "Inerte."],
    "Titânio": ["Boa", "Compatível."],
  },
  "Hidrocarbonetos leves (GLP/nafta)": {
    "Aço carbono": ["Excelente", "Padrão da indústria para hidrocarbonetos não corrosivos/secos."],
    "Aço inox 304/304L": ["Excelente", "Compatível, usado quando há requisito de limpeza/pureza."],
    "Aço inox 316/316L": ["Excelente", "Compatível."],
    "Monel 400": ["Boa", "Compatível, raramente necessário."],
    "Hastelloy C-276": ["Excelente", "Sobre-especificado."],
    "PVC": ["Não recomendado", "Hidrocarbonetos podem amolecer/dissolver PVC."],
    "PTFE (Teflon)": ["Excelente", "Inerte."],
    "Titânio": ["Boa", "Compatível, raramente necessário."],
  },
  "Hidrocarbonetos sour (H2S presente)": {
    "Aço carbono": ["Regular — avaliar", "Requer dureza controlada e resistência a trinca por H2S — atender NACE MR0175/ISO 15156."],
    "Aço inox 304/304L": ["Regular — avaliar", "Suscetível a trinca sob tensão por sulfeto; requer avaliação NACE MR0175/ISO 15156."],
    "Aço inox 316/316L": ["Regular — avaliar", "Requer avaliação NACE MR0175/ISO 15156 conforme dureza/tensão."],
    "Monel 400": ["Regular — avaliar", "Aceito em certas condições sour com restrições de dureza — confirmar NACE MR0175."],
    "Hastelloy C-276": ["Boa", "Amplamente aceito em serviço sour severo, confirmar NACE MR0175."],
    "PVC": ["Não recomendado", "Não adequado para serviço sour em processo."],
    "PTFE (Teflon)": ["Boa", "Inerte quimicamente, mas confirmar adequação mecânica/térmica do sistema."],
    "Titânio": ["Regular — avaliar", "Pode ser suscetível a fragilização por hidrogênio em certas condições sour."],
  },
};

// Conversor de unidades: fator linear em relação à unidade-base de cada categoria
const CONVERSAO = {
  "Vazão": { base: "m³/s", fatores: {
    "L/min": 1/60000, "L/s": 1/1000, "m³/h": 1/3600, "m³/s": 1,
    "GPM (US)": 6.30902e-5, "bbl/d (óleo)": 0.158987/86400,
  }},
  "Pressão": { base: "Pa", fatores: {
    "Pa": 1, "kPa": 1e3, "bar": 1e5, "psi": 6894.76,
    "mca (m coluna d'água)": 9806.65, "kgf/cm²": 98066.5, "atm": 101325,
  }},
  "Comprimento": { base: "m", fatores: {
    "mm": 0.001, "cm": 0.01, "m": 1, "in (polegada)": 0.0254, "ft (pé)": 0.3048,
  }},
  "Potência": { base: "W", fatores: {
    "W": 1, "kW": 1000, "HP (imperial)": 745.7, "CV (métrico)": 735.5,
  }},
  "Viscosidade dinâmica": { base: "Pa·s", fatores: {
    "Pa·s": 1, "mPa·s": 0.001, "cP": 0.001,
  }},
  "Viscosidade cinemática": { base: "m²/s", fatores: {
    "m²/s": 1, "cSt": 1e-6, "mm²/s": 1e-6,
  }},
  "Densidade": { base: "kg/m³", fatores: {
    "kg/m³": 1, "g/cm³": 1000, "lb/ft³": 16.0185,
  }},
};

function velocidade(vazaoM3s, diametroM) {
  const area = Math.PI * diametroM ** 2 / 4;
  return area > 0 ? vazaoM3s / area : 0;
}

function reynolds(v, d, nu = 1.0e-6) {
  return nu > 0 ? (v * d) / nu : 0;
}

function fatorAtritoColebrook(re, rugRel, iter = 50) {
  if (re <= 0) return 0;
  if (re < 2300) return 64 / re;
  let f = 0.02;
  for (let i = 0; i < iter; i++) {
    f = Math.pow(-2 * Math.log10(rugRel / 3.7 + 2.51 / (re * Math.sqrt(f))), -2);
  }
  return f;
}

function perdaDarcy(f, l, d, v) {
  return f * (l / d) * (v ** 2) / (2 * G);
}

function perdaHazen(vazaoM3s, c, d, l) {
  const j = 10.643 * Math.pow(vazaoM3s, 1.852) / Math.pow(c, 1.852) / Math.pow(d, 4.87);
  return j * l;
}

function perdaLocalizada(somaK, v) {
  return somaK * (v ** 2) / (2 * G);
}

function fillSelect(el, obj, selected) {
  el.innerHTML = "";
  Object.keys(obj).forEach((k) => {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = k;
    if (k === selected) opt.selected = true;
    el.appendChild(opt);
  });
}

// Anima a agulha/arco do gauge (0–100% de uma escala 0–3.5 m/s, faixa comum predial)
function setGauge(needleEl, arcEl, valueMs, maxMs = 3.5) {
  const frac = Math.max(0, Math.min(1, valueMs / maxMs));
  const angle = -90 + frac * 180; // -90deg (esquerda) a +90deg (direita)
  needleEl.setAttribute("transform", `rotate(${angle} 100 100)`);
  const circumference = 251; // comprimento aproximado do arco (raio 80, semicírculo)
  arcEl.setAttribute("stroke-dasharray", `${frac * circumference} ${circumference}`);
}

// ---------------- Darcy-Weisbach ----------------
const dwMat = document.getElementById("dw-mat");
fillSelect(dwMat, RUGOSIDADE, "PVC / PPR (novo)");

function updateDW() {
  const qLmin = parseFloat(document.getElementById("dw-q").value) || 0;
  const dMm = parseFloat(document.getElementById("dw-d").value) || 1;
  const lM = parseFloat(document.getElementById("dw-l").value) || 0;
  const mat = dwMat.value;

  const qM3s = qLmin / 60000;
  const dM = dMm / 1000;
  const rug = RUGOSIDADE[mat];

  const v = velocidade(qM3s, dM);
  const re = reynolds(v, dM);
  const rugRel = rug / dM;
  const f = fatorAtritoColebrook(re, rugRel);
  const hf = perdaDarcy(f, lM, dM, v);
  const regime = re < 2300 ? "Laminar" : re < 4000 ? "Transição" : "Turbulento";

  document.getElementById("dw-v-value").textContent = v.toFixed(2);
  document.getElementById("dw-re").textContent = re.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  document.getElementById("dw-regime").textContent = regime;
  document.getElementById("dw-f").textContent = f.toFixed(5);
  document.getElementById("dw-hf").textContent = `${hf.toFixed(3)} m`;
  setGauge(document.getElementById("dw-needle"), document.getElementById("dw-gauge-arc"), v);
  DASH.dw = `${hf.toFixed(3)} m (v=${v.toFixed(2)} m/s)`;
  if (typeof renderDashboard === "function") renderDashboard();

  const alertEl = document.getElementById("dw-alert");
  if (v > 3.0) {
    alertEl.hidden = false;
    alertEl.textContent = "Velocidade acima de 3 m/s — verificar limite normativo (NBR 5626).";
  } else {
    alertEl.hidden = true;
  }
}
["dw-q", "dw-d", "dw-l"].forEach((id) => document.getElementById(id).addEventListener("input", updateDW));
dwMat.addEventListener("change", updateDW);

// ---------------- Hazen-Williams ----------------
const hwMat = document.getElementById("hw-mat");
fillSelect(hwMat, C_HAZEN, "PVC / PPR");

function updateHW() {
  const qLmin = parseFloat(document.getElementById("hw-q").value) || 0;
  const dMm = parseFloat(document.getElementById("hw-d").value) || 1;
  const lM = parseFloat(document.getElementById("hw-l").value) || 0;
  const mat = hwMat.value;

  const qM3s = qLmin / 60000;
  const dM = dMm / 1000;
  const c = C_HAZEN[mat];

  const v = velocidade(qM3s, dM);
  const hf = perdaHazen(qM3s, c, dM, lM);

  document.getElementById("hw-v-value").textContent = v.toFixed(2);
  document.getElementById("hw-c").textContent = c;
  document.getElementById("hw-hf").textContent = `${hf.toFixed(3)} m`;
  setGauge(document.getElementById("hw-needle"), document.getElementById("hw-gauge-arc"), v);

  // Tabela comparativa
  const rows = Object.entries(C_HAZEN)
    .map(([m, cv]) => ({ m, cv, hf: perdaHazen(qM3s, cv, dM, lM) }))
    .sort((a, b) => a.hf - b.hf);
  const tbody = document.querySelector("#hw-table tbody");
  tbody.innerHTML = "";
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (i === 0) tr.className = "best";
    tr.innerHTML = `<td style="font-family:var(--font-body)">${r.m}</td><td>${r.cv}</td><td>${r.hf.toFixed(3)} m</td>`;
    tbody.appendChild(tr);
  });
}
["hw-q", "hw-d", "hw-l"].forEach((id) => document.getElementById(id).addEventListener("input", updateHW));
hwMat.addEventListener("change", updateHW);

// ---------------- ΣK por Trecho ----------------
const skTipo = document.getElementById("sk-tipo");
fillSelect(skTipo, K_CONEXOES, "Cotovelo 90°");

let conexoes = [];

function renderSK() {
  const tbody = document.getElementById("sk-tbody");
  const empty = document.getElementById("sk-empty");
  tbody.innerHTML = "";
  empty.hidden = conexoes.length > 0;

  let somaK = 0;
  conexoes.forEach((c, idx) => {
    const kTotal = c.qtd * c.k;
    somaK += kTotal;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family:var(--font-body)">${c.tipo}</td>
      <td>${c.qtd}</td>
      <td>${c.k.toFixed(2)}</td>
      <td>${kTotal.toFixed(2)}</td>
      <td><button class="row-remove" data-idx="${idx}">remover</button></td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      conexoes.splice(parseInt(btn.dataset.idx, 10), 1);
      renderSK();
    });
  });

  const qLmin = parseFloat(document.getElementById("sk-q").value) || 0;
  const dMm = parseFloat(document.getElementById("sk-d").value) || 1;
  const v = velocidade(qLmin / 60000, dMm / 1000);
  const hLoc = perdaLocalizada(somaK, v);

  document.getElementById("sk-somak").textContent = somaK.toFixed(2);
  document.getElementById("sk-hloc").textContent = `${hLoc.toFixed(3)} m`;
}

document.getElementById("sk-add").addEventListener("click", () => {
  const tipo = skTipo.value;
  const qtd = parseInt(document.getElementById("sk-qtd").value, 10) || 1;
  conexoes.push({ tipo, qtd, k: K_CONEXOES[tipo] });
  renderSK();
});
document.getElementById("sk-clear").addEventListener("click", () => {
  conexoes = [];
  renderSK();
});
["sk-q", "sk-d"].forEach((id) => document.getElementById(id).addEventListener("input", renderSK));

// ---------------- Rede Multitrecho ----------------
const redeMat = document.getElementById("rede-mat");
fillSelect(redeMat, RUGOSIDADE, "PVC / PPR (novo)");

// Biblioteca de Arquétipos de Linha — mesma fonte que a aba "Arquétipos de Linha" da
// planilha (Sprint 46): ΣK típico = soma dos coeficientes de Referência!B23:B31 por
// arquétipo; "material" é o material típico de catálogo da planilha (Fluidos e Tubos),
// que não tem correspondência 1:1 com o catálogo de rugosidade deste app — por isso
// aqui ele é só uma indicação em texto (materialHint), nunca seleciona sozinho o
// Material do trecho. Mantido só como referência rápida — nunca alimenta ΣK/Material
// automaticamente por conta própria (mesma ressalva da planilha).
const ARQUETIPOS_LINHA = [
  { nome: "Linha de sucção de bomba (líquido)", sigmaK: 1.5, material: "Aço Carbono Sch 40" },
  { nome: "Linha de descarga de bomba (líquido)", sigmaK: 5.4, material: "Aço Carbono Sch 40" },
  { nome: "Header de vapor saturado", sigmaK: 11.1, material: "Aço Carbono Sch 40" },
  { nome: "Linha de dreno / purga", sigmaK: 2.5, material: "Aço Carbono Sch 40" },
  { nome: "Header de gás combustível (baixa pressão)", sigmaK: 2.3, material: "Aço Carbono Sch 40" },
  { nome: "Linha de instrumento (impulse line)", sigmaK: 3.1, material: "Aço Carbono Sch 40" },
  { nome: "Linha de amostragem", sigmaK: 2.0, material: "Aço Carbono Sch 40" },
  { nome: "Linha de alívio / descarga de PSV", sigmaK: 1.1, material: "Aço Carbono Sch 40" },
  { nome: "Água de resfriamento — suprimento", sigmaK: 2.7, material: "Ferro Fundido Dúctil" },
  { nome: "Água de resfriamento — retorno", sigmaK: 1.5, material: "Ferro Fundido Dúctil" },
  { nome: "Linha de condensado", sigmaK: 4.5, material: "Aço Carbono Sch 40" },
  { nome: "Linha de ar comprimido", sigmaK: 1.4, material: "Aço Carbono Sch 40" },
  { nome: "Linha de nitrogênio / inertização", sigmaK: 1.0, material: "Aço Carbono Sch 40" },
  { nome: "Linha de transferência de produto", sigmaK: 3.5, material: "PEAD PE100" },
  { nome: "Linha de flare", sigmaK: 0.8, material: "Aço Carbono Sch 40" },
  { nome: "Header de vácuo", sigmaK: 1.0, material: "Aço Carbono Sch 40" },
  { nome: "Linha de óleo térmico", sigmaK: 3.9, material: "Aço Carbono Sch 40" },
  { nome: "Linha de utilidades gerais / água de processo", sigmaK: 2.0, material: "PVC Soldável" },
];

const redeArquetipo = document.getElementById("rede-arquetipo");
const redeArquetipoHint = document.getElementById("rede-arquetipo-hint");
const redeSkInput = document.getElementById("rede-sk");

(() => {
  const optVazio = document.createElement("option");
  optVazio.value = "";
  optVazio.textContent = "— nenhum —";
  redeArquetipo.appendChild(optVazio);
  ARQUETIPOS_LINHA.forEach((a, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = a.nome;
    redeArquetipo.appendChild(opt);
  });
})();

// Sprint N1b: o catálogo de materiais/rugosidade do PWA (RUGOSIDADE) foi unificado com o
// da planilha (aba "Fluidos e Tubos", MATERIAIS_RUG) — agora o Material típico do arquétipo
// pode de fato selecionar o campo Material, não só informar em texto.
// redeMatManual rastreia se o usuário trocou o Material à mão (só o listener "change" seta
// isso — atribuição programática via .value não dispara "change", então não conflita).
let redeMatManual = false;
redeMat.addEventListener("change", () => { redeMatManual = true; });

// Aplica o ΣK típico e o Material típico do arquétipo escolhido SE E SOMENTE SE o
// respectivo campo ainda não tiver detalhamento manual — reproduz a mesma regra da
// planilha (Sprint 46): ΣK manual > 0 sempre prevalece sobre o ΣK típico do arquétipo;
// Material trocado manualmente pelo usuário sempre prevalece sobre o material típico.
function aplicarArquetipoRede() {
  const idx = redeArquetipo.value;
  if (idx === "") {
    redeArquetipoHint.hidden = true;
    return;
  }
  const a = ARQUETIPOS_LINHA[parseInt(idx, 10)];
  const manualSk = parseFloat(redeSkInput.value) || 0;
  if (manualSk === 0) {
    redeSkInput.value = a.sigmaK;
  }
  if (!redeMatManual && a.material in RUGOSIDADE) {
    redeMat.value = a.material;
  }

  redeArquetipoHint.hidden = false;
  const skMsg = manualSk === 0
    ? `ΣK típico aplicado (${a.sigmaK.toFixed(2)})`
    : `ΣK manual (${manualSk.toFixed(2)}) prevalece sobre o típico (${a.sigmaK.toFixed(2)})`;
  const matMsg = redeMatManual
    ? `Material mantido como você escolheu (típico do arquétipo seria ${a.material})`
    : `Material aplicado: ${a.material}`;
  redeArquetipoHint.textContent = `${skMsg}. ${matMsg}.`;
}
redeArquetipo.addEventListener("change", aplicarArquetipoRede);
// Se o usuário zerar o ΣK manual com um arquétipo já escolhido, o típico volta a valer
// (mesmo comportamento de recálculo ao vivo da planilha).
redeSkInput.addEventListener("input", () => {
  if (redeArquetipo.value !== "") aplicarArquetipoRede();
});

let trechosRede = [];

function renderRede() {
  const tbody = document.getElementById("rede-tbody");
  const empty = document.getElementById("rede-empty");
  tbody.innerHTML = "";
  empty.hidden = trechosRede.length > 0;

  let totalRede = 0;
  trechosRede.forEach((t, idx) => {
    totalRede += t.total;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family:var(--font-body)">${t.nome}</td>
      <td>${t.v.toFixed(2)}</td>
      <td>${t.hfDist.toFixed(3)}</td>
      <td>${t.hfLoc.toFixed(3)}</td>
      <td>${t.total.toFixed(3)}</td>
      <td><button class="row-remove" data-idx="${idx}">remover</button></td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll("#rede-tbody .row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      trechosRede.splice(parseInt(btn.dataset.idx, 10), 1);
      renderRede();
    });
  });

  document.getElementById("rede-count").textContent = trechosRede.length;
  document.getElementById("rede-total").textContent = `${totalRede.toFixed(3)} m`;
  DASH.rede = `${totalRede.toFixed(3)} m (${trechosRede.length} trechos)`;
  if (typeof renderDashboard === "function") renderDashboard();
}

document.getElementById("rede-add").addEventListener("click", () => {
  const nome = document.getElementById("rede-nome").value.trim() || `Trecho ${trechosRede.length + 1}`;
  const qLmin = parseFloat(document.getElementById("rede-q").value) || 0;
  const dMm = parseFloat(document.getElementById("rede-d").value) || 1;
  const lM = parseFloat(document.getElementById("rede-l").value) || 0;
  const somaK = parseFloat(document.getElementById("rede-sk").value) || 0;
  const mat = redeMat.value;

  const qM3s = qLmin / 60000;
  const dM = dMm / 1000;
  const rug = RUGOSIDADE[mat];

  const v = velocidade(qM3s, dM);
  const re = reynolds(v, dM);
  const f = fatorAtritoColebrook(re, rug / dM);
  const hfDist = perdaDarcy(f, lM, dM, v);
  const hfLoc = perdaLocalizada(somaK, v);

  trechosRede.push({ nome, v, hfDist, hfLoc, total: hfDist + hfLoc, l: lM, qLmin });
  renderRede();

  // Sugere o próximo nome automaticamente
  document.getElementById("rede-nome").value = `Trecho ${trechosRede.length + 1}`;
});

document.getElementById("rede-clear").addEventListener("click", () => {
  trechosRede = [];
  renderRede();
  document.getElementById("rede-nome").value = "Trecho 1";
});

// ---------------- Utilitário: mini gráfico de linhas em SVG ----------------
// series: array de {points: [{x,y}], color, dashed}. Escala automática nos eixos.
function drawLineChart(svgEl, series, markers = []) {
  const W = 300, H = 160, PAD = 22;
  svgEl.innerHTML = "";
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);

  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length < 2) {
    svgEl.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" font-size="10" fill="#5B6E69">adicione ao menos 2 pontos</text>`;
    return;
  }
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (xMax === xMin) xMax += 1;
  if (yMax === yMin) { yMax += 1; yMin -= 1; }
  const yPad = (yMax - yMin) * 0.1;
  yMin -= yPad; yMax += yPad;

  const sx = (x) => PAD + ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD);
  const sy = (y) => H - PAD - ((y - yMin) / (yMax - yMin)) * (H - 2 * PAD);

  const ns = "http://www.w3.org/2000/svg";
  // eixos
  const axisX = document.createElementNS(ns, "line");
  axisX.setAttribute("x1", PAD); axisX.setAttribute("x2", W - PAD);
  axisX.setAttribute("y1", H - PAD); axisX.setAttribute("y2", H - PAD);
  axisX.setAttribute("stroke", "#C9D6D2"); axisX.setAttribute("stroke-width", "1");
  svgEl.appendChild(axisX);

  series.forEach((s) => {
    const d = s.points
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`)
      .join(" ");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", s.color);
    path.setAttribute("stroke-width", "2.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    if (s.dashed) path.setAttribute("stroke-dasharray", "4 3");
    svgEl.appendChild(path);
  });

  markers.forEach((m) => {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", sx(m.x)); c.setAttribute("cy", sy(m.y));
    c.setAttribute("r", "4.5"); c.setAttribute("fill", m.color || "#C4491D");
    c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", "1.5");
    svgEl.appendChild(c);
  });
}

// ---------------- Linha Piezométrica ----------------
let pontosPiezo = [];

function renderPiezo() {
  const cotaRes = parseFloat(document.getElementById("piezo-cota-res").value) || 0;
  const tbody = document.getElementById("piezo-tbody");
  const empty = document.getElementById("piezo-empty");
  tbody.innerHTML = "";
  empty.hidden = pontosPiezo.length > 0;

  let temRisco = false;
  const ordenados = pontosPiezo.slice().sort((a, b) => a.dist - b.dist);
  const terrenoPts = [], piezoPts = [];

  ordenados.forEach((p) => {
    const cotaPiezo = cotaRes - p.perda;
    const pressaoDisp = cotaPiezo - p.cotaTerreno;
    const risco = pressaoDisp < 0;
    if (risco) temRisco = true;
    terrenoPts.push({ x: p.dist, y: p.cotaTerreno });
    piezoPts.push({ x: p.dist, y: cotaPiezo });

    const idxOriginal = pontosPiezo.indexOf(p);
    const tr = document.createElement("tr");
    if (risco) tr.className = "risk";
    tr.innerHTML = `
      <td style="font-family:var(--font-body)">${p.nome}</td>
      <td>${p.dist.toFixed(1)}</td>
      <td>${p.cotaTerreno.toFixed(2)}</td>
      <td>${cotaPiezo.toFixed(2)}</td>
      <td>${pressaoDisp.toFixed(2)}</td>
      <td><button class="row-remove" data-idx="${idxOriginal}">remover</button></td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll("#piezo-tbody .row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      pontosPiezo.splice(parseInt(btn.dataset.idx, 10), 1);
      renderPiezo();
    });
  });

  drawLineChart(document.getElementById("piezo-chart"), [
    { points: terrenoPts, color: "#B5722E" },
    { points: piezoPts, color: "#0E4B43", dashed: true },
  ]);

  const alertEl = document.getElementById("piezo-alert");
  if (temRisco) {
    alertEl.hidden = false;
    alertEl.textContent = "Risco de subpressão: a linha piezométrica passa abaixo do terreno em pelo menos um ponto.";
  } else {
    alertEl.hidden = true;
  }
}

document.getElementById("piezo-add").addEventListener("click", () => {
  const nome = document.getElementById("piezo-nome").value.trim() || `Ponto ${pontosPiezo.length + 1}`;
  const dist = parseFloat(document.getElementById("piezo-dist").value) || 0;
  const cotaTerreno = parseFloat(document.getElementById("piezo-cota-terreno").value) || 0;
  // perda acumulada estimada por interpolação simples a partir dos pontos existentes da rede, se não vier de "puxar"
  pontosPiezo.push({ nome, dist, cotaTerreno, perda: 0 });
  renderPiezo();
});

document.getElementById("piezo-pull").addEventListener("click", () => {
  let distAcum = 0, perdaAcum = 0;
  if (pontosPiezo.length === 0) {
    pontosPiezo.push({ nome: "Reservatório / origem", dist: 0, perda: 0, cotaTerreno: 0 });
  }
  trechosRede.forEach((t) => {
    distAcum += t.l || 0;
    perdaAcum += t.total;
    pontosPiezo.push({ nome: t.nome, dist: distAcum, perda: perdaAcum, cotaTerreno: 0 });
  });
  renderPiezo();
});

document.getElementById("piezo-cota-res").addEventListener("input", renderPiezo);
document.getElementById("piezo-clear").addEventListener("click", () => {
  pontosPiezo = [];
  renderPiezo();
});

// ---------------- Bomba — Ponto de Operação ----------------
function updateBomba() {
  const H0 = parseFloat(document.getElementById("bomba-h0").value) || 0;
  const Qn = parseFloat(document.getElementById("bomba-qn").value) || 1;
  const Hn = parseFloat(document.getElementById("bomba-hn").value) || 0;
  const Hest = parseFloat(document.getElementById("bomba-hest").value) || 0;
  const k = parseFloat(document.getElementById("bomba-k").value) || 0;

  const a = (H0 - Hn) / (Qn ** 2); // coeficiente da parábola da bomba
  const alertEl = document.getElementById("bomba-alert");

  const denom = a + k;
  const qopValido = denom > 0 && (H0 - Hest) / denom >= 0;
  let Qop = 0, Hop = 0;

  if (qopValido) {
    Qop = Math.sqrt((H0 - Hest) / denom);
    Hop = H0 - a * Qop ** 2;
    alertEl.hidden = true;
  } else {
    alertEl.hidden = false;
    alertEl.textContent = "Não há interseção válida entre as curvas com esses parâmetros — revise H0, Hest ou k.";
  }

  document.getElementById("bomba-qop").textContent = qopValido ? `${Qop.toFixed(1)} L/min` : "—";
  document.getElementById("bomba-hop").textContent = qopValido ? `${Hop.toFixed(2)} m` : "—";
  DASH.bomba = qopValido ? `${Qop.toFixed(1)} L/min @ ${Hop.toFixed(2)} m` : "sem interseção";
  // T-523 (2026-09-28): handoff pra Planta Virtual (bomba_centrifuga). Chaves = nomes de
  // `parametros` do contrato `bomba_centrifuga` (H0_m, Hn_m, Qn_L_min, k_sistema). Hest não
  // vai junto: na Planta Virtual ele é a porta de entrada (varia ponto a ponto), não parâmetro.
  const paramsValidos = H0 > Hn && Hn > 0 && Qn > 0 && k >= 0;
  DASH_RAW.bomba = paramsValidos ? { H0_m: H0, Hn_m: Hn, Qn_L_min: Qn, k_sistema: k } : null;
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("bomba");
  if (typeof renderDashboard === "function") renderDashboard();

  const qMax = Math.max(Qn * 1.4, qopValido ? Qop * 1.3 : Qn * 1.4);
  const N = 24;
  const curvaBomba = [], curvaSistema = [];
  for (let i = 0; i <= N; i++) {
    const q = (qMax / N) * i;
    curvaBomba.push({ x: q, y: Math.max(0, H0 - a * q ** 2) });
    curvaSistema.push({ x: q, y: Hest + k * q ** 2 });
  }

  drawLineChart(
    document.getElementById("bomba-chart"),
    [
      { points: curvaBomba, color: "#0E4B43" },
      { points: curvaSistema, color: "#B5722E" },
    ],
    qopValido ? [{ x: Qop, y: Hop, color: "#C4491D" }] : []
  );
}

["bomba-h0", "bomba-qn", "bomba-hn", "bomba-hest", "bomba-k"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateBomba)
);

document.getElementById("bomba-pull").addEventListener("click", () => {
  if (trechosRede.length === 0) return;
  const totalPerda = trechosRede.reduce((sum, t) => sum + t.total, 0);
  const qMedia = trechosRede.reduce((sum, t) => sum + (t.qLmin || 0), 0) / trechosRede.length;
  if (qMedia > 0) {
    document.getElementById("bomba-k").value = (totalPerda / qMedia ** 2).toFixed(6);
    updateBomba();
  }
});

// ---------------- Fluidos Petroquímicos ----------------
const flFluido = document.getElementById("fl-fluido");
fillSelect(flFluido, FLUIDOS_PETROQ, "Água");

function aplicarFluido() {
  const dados = FLUIDOS_PETROQ[flFluido.value];
  document.getElementById("fl-rho").value = dados.rho;
  document.getElementById("fl-mu").value = dados.mu;
  updateFluido();
}
flFluido.addEventListener("change", aplicarFluido);

function updateFluido() {
  const qLmin = parseFloat(document.getElementById("fl-q").value) || 0;
  const dMm = parseFloat(document.getElementById("fl-d").value) || 1;
  const rho = parseFloat(document.getElementById("fl-rho").value) || 1;
  const muCp = parseFloat(document.getElementById("fl-mu").value) || 1;

  const qM3s = qLmin / 60000;
  const dM = dMm / 1000;
  const nu = (muCp * 1e-3) / rho; // viscosidade cinemática (m²/s)

  const v = velocidade(qM3s, dM);
  const re = reynolds(v, dM, nu);
  const regime = re < 2300 ? "Laminar" : re < 4000 ? "Transição" : "Turbulento";

  document.getElementById("fl-v-value").textContent = v.toFixed(2);
  document.getElementById("fl-re").textContent = re.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  document.getElementById("fl-regime").textContent = regime;
  setGauge(document.getElementById("fl-needle"), document.getElementById("fl-gauge-arc"), v);

  const alertEl = document.getElementById("fl-alert");
  if (v > 3.0) {
    alertEl.hidden = false;
    alertEl.textContent = "Velocidade acima de 3 m/s — verificar limite de erosão/ruído para este fluido.";
  } else {
    alertEl.hidden = true;
  }
}
["fl-rho", "fl-mu", "fl-q", "fl-d"].forEach((id) => document.getElementById(id).addEventListener("input", updateFluido));
aplicarFluido();

// ---------------- Escoamento Compressível ----------------
const compGas = document.getElementById("comp-gas");
fillSelect(compGas, GASES, "Ar");
const compMat = document.getElementById("comp-mat");
fillSelect(compMat, RUGOSIDADE, "Aço galvanizado (novo)");

function aplicarGasComp() {
  const dados = GASES[compGas.value];
  document.getElementById("comp-m").value = dados.m;
  document.getElementById("comp-mu").value = dados.mu;
  updateComp();
}
compGas.addEventListener("change", aplicarGasComp);

function updateComp() {
  const M = parseFloat(document.getElementById("comp-m").value) || 1;
  const muPas = (parseFloat(document.getElementById("comp-mu").value) || 0.01) * 1e-3;
  const tC = parseFloat(document.getElementById("comp-t").value) || 20;
  const p1Barg = parseFloat(document.getElementById("comp-p1").value) || 0;
  const qStd = parseFloat(document.getElementById("comp-q").value) || 0;
  const dMm = parseFloat(document.getElementById("comp-d").value) || 1;
  const lM = parseFloat(document.getElementById("comp-l").value) || 0.1;
  const rug = RUGOSIDADE[compMat.value];

  const T = tC + 273.15;
  const rhoStd = (101325 * M) / (R_UNIV * 273.15);
  const mdot = (qStd / 3600) * rhoStd;
  const dM = dMm / 1000;
  const area = Math.PI * dM ** 2 / 4;
  const gMassa = mdot / area;
  const re = muPas > 0 ? (gMassa * dM) / muPas : 0;
  const rugRel = rug / dM;
  const f = fatorAtritoColebrook(re, rugRel);

  const p1 = (p1Barg + 1.01325) * 1e5; // Pa abs
  const deltaP2 = f * (lM / dM) * gMassa ** 2 * R_UNIV * T / M;
  const p2sq = p1 ** 2 - deltaP2;
  const valido = p2sq > 0;
  const p2 = valido ? Math.sqrt(p2sq) : 0;

  const regime = re < 2300 ? "Laminar" : re < 4000 ? "Transição" : "Turbulento";
  document.getElementById("comp-re").textContent = `${re.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} (${regime})`;
  document.getElementById("comp-f").textContent = f.toFixed(5);

  const alertEl = document.getElementById("comp-alert");
  if (valido) {
    const rho1 = (p1 * M) / (R_UNIV * T);
    const rho2 = (p2 * M) / (R_UNIV * T);
    const v1 = mdot / (rho1 * area);
    const v2 = mdot / (rho2 * area);
    document.getElementById("comp-v1").textContent = `${v1.toFixed(2)} m/s`;
    document.getElementById("comp-v2").textContent = `${v2.toFixed(2)} m/s`;
    document.getElementById("comp-p2").textContent = `${(p2 / 1e5 - 1.01325).toFixed(3)} bar (man.)`;
    document.getElementById("comp-dp").textContent = `${((p1 - p2) / 1e5).toFixed(4)} bar`;
    alertEl.hidden = true;
  } else {
    document.getElementById("comp-v1").textContent = "—";
    document.getElementById("comp-v2").textContent = "—";
    document.getElementById("comp-p2").textContent = "—";
    document.getElementById("comp-dp").textContent = "—";
    alertEl.hidden = false;
    alertEl.textContent = "Sem solução real: a perda por atrito excede a pressão disponível — aumente o diâmetro, reduza a vazão/comprimento ou revise P1.";
  }
}
["comp-m", "comp-mu", "comp-t", "comp-p1", "comp-q", "comp-d", "comp-l"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateComp)
);
compMat.addEventListener("change", updateComp);
aplicarGasComp();

// ---------------- Bifásico + Erosão (API RP14E) ----------------
const bifGas = document.getElementById("bif-gas");
fillSelect(bifGas, GASES, "Gás natural (típico)");
const bifLiquido = document.getElementById("bif-liquido");
fillSelect(bifLiquido, FLUIDOS_PETROQ, "Óleo cru leve (~35 °API)");

function aplicarBif() {
  document.getElementById("bif-m").value = GASES[bifGas.value].m;
  document.getElementById("bif-rhol").value = FLUIDOS_PETROQ[bifLiquido.value].rho;
  updateBif();
}
bifGas.addEventListener("change", aplicarBif);
bifLiquido.addEventListener("change", aplicarBif);

function updateBif() {
  const M = parseFloat(document.getElementById("bif-m").value) || 1;
  const qGasStd = parseFloat(document.getElementById("bif-qg").value) || 0;
  const rhoLiq = parseFloat(document.getElementById("bif-rhol").value) || 1;
  const qLiq = parseFloat(document.getElementById("bif-ql").value) || 0;
  const tC = parseFloat(document.getElementById("bif-t").value) || 20;
  const pBarg = parseFloat(document.getElementById("bif-p").value) || 0;
  const dMm = parseFloat(document.getElementById("bif-d").value) || 1;
  const c = parseFloat(document.getElementById("bif-c").value) || 100;

  const T = tC + 273.15;
  const pOp = (pBarg + 1.01325) * 1e5;
  const rhoGasOp = (pOp * M) / (R_UNIV * T);

  const wGas = (qGasStd / 3600) * ((101325 * M) / (R_UNIV * 273.15)); // kg/s (massa conservada)
  const qGasOp = wGas / rhoGasOp; // m³/s nas condições de operação
  const wLiq = (qLiq / 3600) * rhoLiq; // kg/s
  const qLiqM3s = qLiq / 3600;

  const rhoM = (wGas + wLiq) / (qGasOp + qLiqM3s);
  const dM = dMm / 1000;
  const area = Math.PI * dM ** 2 / 4;
  const vM = (qGasOp + qLiqM3s) / area;
  const ve = (1.22 * c) / Math.sqrt(rhoM);

  document.getElementById("bif-rhom").textContent = `${rhoM.toFixed(1)} kg/m³`;
  document.getElementById("bif-ve").textContent = `${ve.toFixed(2)} m/s`;
  document.getElementById("bif-vm").textContent = `${vM.toFixed(2)} m/s`;

  const alertEl = document.getElementById("bif-alert");
  if (vM > ve) {
    alertEl.hidden = false;
    alertEl.textContent = `Velocidade da mistura (${vM.toFixed(2)} m/s) acima da velocidade erosional API RP14E (${ve.toFixed(2)} m/s) — risco de erosão, aumentar diâmetro.`;
  } else {
    alertEl.hidden = true;
  }
}
["bif-m", "bif-qg", "bif-rhol", "bif-ql", "bif-t", "bif-p", "bif-d"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateBif)
);
document.getElementById("bif-c").addEventListener("change", updateBif);
aplicarBif();

// ---------------- Espessura de Parede (ASME B31.3) ----------------
const espMatPreset = document.getElementById("esp-mat-preset");
fillSelect(espMatPreset, MATERIAIS_B31_3, "A106 Gr.B (aço carbono)");
espMatPreset.addEventListener("change", () => {
  document.getElementById("esp-s").value = MATERIAIS_B31_3[espMatPreset.value];
  updateEsp();
});

function updateEsp() {
  const P = parseFloat(document.getElementById("esp-p").value) || 0;
  const Do = parseFloat(document.getElementById("esp-do").value) || 1;
  const S = parseFloat(document.getElementById("esp-s").value) || 1;
  const E = parseFloat(document.getElementById("esp-e").value) || 1;
  const Y = parseFloat(document.getElementById("esp-y").value) || 0.4;
  const c = parseFloat(document.getElementById("esp-c").value) || 0;
  const W = 1.0; // fator de redução de resistência da solda — 1,0 para a maioria dos casos (temp. moderada)

  const alertEl = document.getElementById("esp-alert");
  const denom = S * E * W + P * Y;
  if (denom <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Combinação de parâmetros inválida (denominador ≤ 0) — revise S, E ou Y.";
    ["esp-t", "esp-tm", "esp-tnom"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }
  alertEl.hidden = true;

  const t = (P * Do) / (2 * denom);
  const tm = t + c;
  const tnom = tm / 0.875;

  document.getElementById("esp-t").textContent = `${t.toFixed(3)} mm`;
  document.getElementById("esp-tm").textContent = `${tm.toFixed(3)} mm`;
  document.getElementById("esp-tnom").textContent = `${tnom.toFixed(3)} mm`;

  if (t > Do / 6) {
    alertEl.hidden = false;
    alertEl.textContent = "t calculado > Do/6 — fora da faixa de validade do coeficiente Y tabulado para parede fina; usar a formulação de parede espessa do B31.3.";
  }
}
["esp-p", "esp-do", "esp-s", "esp-y", "esp-c"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateEsp)
);
document.getElementById("esp-e").addEventListener("change", updateEsp);
updateEsp();

// ---------------- Conformidade JIP33/IOGP — Raio de Curvatura (Sprint H10) ----------------
function updateJip33() {
  const Do = parseFloat(document.getElementById("esp-do").value) || 1;
  const mult = parseFloat(document.getElementById("jip-tipo").value) || 1.5;
  const raio = parseFloat(document.getElementById("jip-raio").value) || 0;
  const ref = mult * Do;

  document.getElementById("jip-ref").textContent = `${ref.toFixed(1)} mm`;

  const alertEl = document.getElementById("jip-alert");
  const okEl = document.getElementById("jip-ok");
  if (raio >= ref * 0.98) {
    alertEl.hidden = true;
    okEl.hidden = false;
    DASH.jip33 = "OK — raio dentro da referência ASME";
  } else {
    okEl.hidden = true;
    alertEl.hidden = false;
    alertEl.textContent = `REVISAR — raio informado (${raio.toFixed(1)} mm) é menor que o valor de referência ASME (${ref.toFixed(1)} mm) para o tipo/DN selecionado. Checar se é curva especial com justificativa técnica documentada, ou corrigir a especificação.`;
    DASH.jip33 = "REVISAR — raio abaixo da referência ASME";
  }
}
["esp-do", "jip-raio"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateJip33)
);
document.getElementById("jip-tipo").addEventListener("change", updateJip33);
updateJip33();

// ---------------- Válvula de Controle (Cv/Kv, ISA 75) ----------------
const cvFluido = document.getElementById("cv-fluido");
fillSelect(cvFluido, FLUIDOS_PETROQ, "Água");
cvFluido.addEventListener("change", () => {
  document.getElementById("cv-sg").value = (FLUIDOS_PETROQ[cvFluido.value].rho / 998).toFixed(3);
  updateCv();
});

function updateCv() {
  const sg = parseFloat(document.getElementById("cv-sg").value) || 1;
  const q = parseFloat(document.getElementById("cv-q").value) || 0;
  const dp = parseFloat(document.getElementById("cv-dp").value) || 0.01;

  const kv = q / Math.sqrt(dp / sg);
  const cv = 1.156 * kv;

  document.getElementById("cv-kv").textContent = kv.toFixed(2);
  document.getElementById("cv-cv").textContent = cv.toFixed(2);
  // T-521 (2026-09-28): handoff pra Planta Virtual (valvula_controle_cv). Chaves = nomes de
  // `parametros` do contrato `valvula_controle_cv` (SG, dP_bar). A vazão Q não vai junto: na
  // Planta Virtual ela é a porta de entrada (varia ponto a ponto), não parâmetro.
  const sgValido = parseFloat(document.getElementById("cv-sg").value) > 0;
  const dpValido = parseFloat(document.getElementById("cv-dp").value) > 0;
  DASH_RAW.cv = sgValido && dpValido ? { SG: sg, dP_bar: dp } : null;
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("cv");
}
["cv-sg", "cv-q", "cv-dp"].forEach((id) => document.getElementById(id).addEventListener("input", updateCv));
updateCv();

// ---------------- PSV — Válvula de Alívio (API 520 Parte I) ----------------
const psvGas = document.getElementById("psv-gas");
fillSelect(psvGas, GASES, "Ar");
psvGas.addEventListener("change", () => {
  document.getElementById("psv-m").value = GASES[psvGas.value].m;
  updatePsv();
});

function orificioApi526(areaMm2) {
  for (const [nome, area] of ORIFICIOS_API526) {
    if (area >= areaMm2) return `${nome} (${area.toFixed(1)} mm²)`;
  }
  return "> T — acima da série padrão, avaliar múltiplas válvulas";
}

function updatePsv() {
  const W = parseFloat(document.getElementById("psv-w").value) || 0;
  const pset = parseFloat(document.getElementById("psv-pset").value) || 0;
  const sobre = parseFloat(document.getElementById("psv-sobre").value) || 10;
  const M = parseFloat(document.getElementById("psv-m").value) || 1;
  const k = parseFloat(document.getElementById("psv-k").value) || 1.4;
  const tC = parseFloat(document.getElementById("psv-t").value) || 15;
  const kd = parseFloat(document.getElementById("psv-kd").value) || 0.975;
  const kc = parseFloat(document.getElementById("psv-kc").value) || 1.0;
  const kb = 1.0; // contrapressão baixa / válvula convencional

  const T = tC + 273.15;
  const p1Gauge = pset * (1 + sobre / 100);
  const p1AbsPa = (p1Gauge + 1.01325) * 1e5;

  const expo = (k + 1) / (k - 1);
  const termo = Math.pow(2 / (k + 1), expo);
  const gTeorico = p1AbsPa * Math.sqrt(((k * M) / (R_UNIV * T)) * termo);
  const wKgs = W / 3600;
  const areaM2 = wKgs / (kd * kb * kc * gTeorico);
  const areaMm2 = areaM2 * 1e6;

  document.getElementById("psv-p1").textContent = `${(p1AbsPa / 1e5).toFixed(3)} bar abs`;
  document.getElementById("psv-g").textContent = `${gTeorico.toFixed(1)} kg/(m²·s)`;
  document.getElementById("psv-a").textContent = `${areaMm2.toFixed(2)} mm²`;
  document.getElementById("psv-orificio").textContent = orificioApi526(areaMm2);
  DASH.psv = orificioApi526(areaMm2);
  if (typeof renderDashboard === "function") renderDashboard();

  const alertEl = document.getElementById("psv-alert");
  if (k <= 1.0 || T <= 0 || W <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Parâmetros insuficientes ou inválidos para o cálculo — confira W, k e temperatura.";
  } else {
    alertEl.hidden = true;
  }

  // T-520 (2026-09-28): handoff pra Planta Virtual (psv_api520). Chaves = nomes de `parametros`
  // do contrato `psv_api520` que têm o MESMO significado neste módulo: sobrepressao_frac (aqui em
  // %, vai /100), M_kg_kmol, k, T_c, Kd, Kc. NÃO vão: W (aqui é entrada direta; no ativo é
  // calculado pelo cenário de incêndio a partir de A_molhada/h_lv/F), pset (é a porta de entrada
  // P_set_pa do nó) e Kb (aqui fixo em 1,0 por hipótese, não é campo do usuário). Validação sobre
  // os valores brutos dos campos: os `|| default` acima mascarariam campo vazio/zero.
  const rSobre = parseFloat(document.getElementById("psv-sobre").value);
  const rM = parseFloat(document.getElementById("psv-m").value);
  const rK = parseFloat(document.getElementById("psv-k").value);
  const rT = parseFloat(document.getElementById("psv-t").value);
  const rKd = parseFloat(document.getElementById("psv-kd").value);
  const rKc = parseFloat(document.getElementById("psv-kc").value);
  const psvValido = rSobre > 0 && rM > 0 && rK > 1 && Number.isFinite(rT) && rT + 273.15 > 0 && rKd > 0 && rKc > 0;
  DASH_RAW.psv = psvValido
    ? { sobrepressao_frac: rSobre / 100, M_kg_kmol: rM, k: rK, T_c: rT, Kd: rKd, Kc: rKc }
    : null;
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("psv");
}
["psv-w", "psv-pset", "psv-sobre", "psv-m", "psv-k", "psv-t", "psv-kd"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updatePsv)
);
document.getElementById("psv-kc").addEventListener("change", updatePsv);
updatePsv();

// ---------------- Painel: estado dos últimos resultados de cada módulo ----------------
// (const DASH movida para o topo do arquivo — ver Achado F4, corrigido nesta sessão)

function irParaModulo(id) {
  const tab = document.querySelector(`.tab[data-target="${id}"]`);
  if (tab) tab.click();
}

// ---------------- Handoff pra Planta Virtual (2026-09-11, prova de conceito: torre) ----------------
// Mecanismo: postMessage entre o editor (pai, iframe) e este PWA (filho),
// especificado em ESCOPO_ponte-hydrocalc-motor-novo_2026-09-11.md. Só ativo
// quando a página foi aberta com ?modulo=X&retorno=1 -- fora desse fluxo o
// HydroCalc funciona exatamente como sempre, sem nenhum botão extra visível.
const MODULOS_COM_HANDOFF = []; // populado por registrarHandoff() -- ver logo abaixo.
// Generalizado em 2026-09-14 (decisão do usuário: "gerador reaproveitável" em vez de
// cabear cada módulo novo à mão -- ver ESCOPO_ponte-hydrocalc-motor-novo_2026-09-11.md,
// decisão #6). Antes desta mudança, adicionar handoff a um módulo novo exigia tocar em
// 2 arquivos (o botão em HTML aqui, a entrada no array em JS) além do DASH_RAW.X (que
// continua sendo escrito à mão dentro de cada updateXxx() -- isso é irredutível, é
// físico-específico de cada módulo, não boilerplate). Agora é só 1 chamada de função,
// e o botão nem existe em HTML nenhum -- é criado por JS na primeira execução.

/**
 * Registra um módulo como candidato a handoff pra Planta Virtual: cria o botão "Usar
 * na Planta Virtual" dentro da seção do módulo (não precisa existir em HTML) e marca
 * o módulo como habilitado. Chamar 1 vez por módulo, em qualquer ponto do script
 * (idempotente -- chamar de novo não duplica nada).
 *
 * @param {string} idModulo   mesmo id de `data-module` da seção e de `DASH_RAW.<id>`
 * @param {string} tooltip    texto do title= do botão (explica o que é enviado, e
 *                            "APROXIMAÇÃO: ..." se for o caso -- mesma disciplina dos
 *                            6 módulos que já tinham isso antes de generalizar)
 * @param {string} [rotulo]   texto do botão, default "Usar na Planta Virtual" --
 *                            passar "Usar na Planta Virtual (aproximado)" pros casos
 *                            que hoje já usam isso (hcross, incendio)
 */
function registrarHandoff(idModulo, tooltip, rotulo) {
  if (MODULOS_COM_HANDOFF.includes(idModulo)) return; // idempotente

  const secao = document.querySelector(`.module[data-module="${idModulo}"]`);
  if (!secao) {
    console.warn(`registrarHandoff("${idModulo}"): seção .module[data-module="${idModulo}"] não encontrada no DOM -- botão não criado, módulo NÃO registrado (evita entrada morta em MODULOS_COM_HANDOFF).`);
    return;
  }

  if (!document.getElementById(`handoff-btn-${idModulo}`)) {
    const btn = document.createElement("button");
    btn.id = `handoff-btn-${idModulo}`;
    btn.className = "btn-add";
    btn.hidden = true;
    btn.disabled = true;
    btn.title = tooltip;
    btn.textContent = rotulo || "Usar na Planta Virtual";

    const nota = secao.querySelector(".empty-note");
    if (nota) secao.insertBefore(btn, nota);
    else secao.appendChild(btn);
  }

  MODULOS_COM_HANDOFF.push(idModulo);
}

// ---- Registro dos 6 módulos já cabeados (só a chamada, o botão HTML foi removido) ----
registrarHandoff("torre", "Envia C_alvo e L/G calculados pra Planta Virtual");
registrarHandoff("jthid", "Envia T1/P1/P2/gamma pra Planta Virtual");
registrarHandoff("hcross",
  "APROXIMAÇÃO: envia um fator de demanda relativo (vazão resolvida / vazão inicial desta rede), não a topologia real -- a Planta Virtual usa uma rede fixa diferente desta",
  "Usar na Planta Virtual (aproximado)");
registrarHandoff("orificio", "Envia ΔP (Pa) pra Planta Virtual");
registrarHandoff("incendio",
  "APROXIMAÇÃO: envia a Área de projeto (Parte A, m²) pra Planta Virtual como área protegida -- a Área a proteger da Parte B (sistema de espuma) não é enviada, os 2 campos não são sincronizados neste formulário",
  "Usar na Planta Virtual (aproximado)");
registrarHandoff("amina_kremser", "Envia L, G, m, N_estágios, y_in, x_in pra Planta Virtual (coluna de absorção)");

// ---- Extensão 2026-09-14: os 9 novos ativos do Achado 3 (mesma receita, ver
// 00_PATCH_handoff-n3-generalizado_2026-09-14.md) -- cada DASH_RAW.X já escrito
// dentro do updateX() correspondente, mapeamento 1:1 confirmado contra
// contrato_ativo.py pros 9, nenhuma aproximação declarada (diferente de
// hcross/incendio acima) ----
registrarHandoff("separador_api", "Envia ρ_água, ρ_óleo, μ_água, fator de turbulência F e razão D/W pra Planta Virtual");
registrarHandoff("protecao_catodica", "Envia densidade de corrente, vida útil, material do ânodo, fator de utilização e massa unitária pra Planta Virtual");
registrarHandoff("purgadores", "Envia h_fg e fator de segurança pra Planta Virtual");
registrarHandoff("hrsg", "Envia os 9 parâmetros de projeto do HRSG (cp's, T_sat, pinch, approach, T_água_alimentação, ΔT_superaquecimento) pra Planta Virtual");
registrarHandoff("blowdown", "Envia V, T0, MW, k, Cd, área do orifício e pressões de downstream/alvo pra Planta Virtual");
registrarHandoff("silo_jenike", "Envia tensão de consolidação, densidade bulk e H(θ) pra Planta Virtual");
registrarHandoff("boiloff", "Envia área, condutividade e espessura do isolamento, temperatura de armazenamento e h_fg pra Planta Virtual");
registrarHandoff("coluna_recheio", "Envia C-factor, densidades de líquido/vapor e fração de inundação pra Planta Virtual");
registrarHandoff("bomba", "Envia H0, Hn, Qn (curva da bomba) e k do sistema pra Planta Virtual (bomba centrífuga); a altura estática Hest não é enviada -- é entrada da Planta Virtual");
registrarHandoff("cv", "Envia densidade relativa (SG) e ΔP da válvula pra Planta Virtual (válvula de controle Kv/Cv); a vazão Q não é enviada -- é entrada da Planta Virtual");
registrarHandoff("psv", "Envia sobrepressão, M, k, T, Kd e Kc pra Planta Virtual (PSV API 520/526); a vazão de alívio W e a pressão de ajuste não são enviadas -- W é calculada pelo cenário de incêndio no ativo e a pressão de ajuste é entrada da Planta Virtual; Kb não é enviado (fixo em 1,0 neste módulo)");
registrarHandoff("transientes", "Envia tubo, comprimento, tempo de fechamento e pressão de serviço pra Planta Virtual (golpe de aríete, modelo simplificado Joukowsky/Allievi-Michaud); a velocidade não é enviada -- é entrada da Planta Virtual");
registrarHandoff("aminas", "Envia composição do gás ácido, remoção fracionária, loading, concentração/densidade da solução e tipo de amina pra Planta Virtual");

function atualizarBotaoHandoff(idModulo) {
  const btn = document.getElementById(`handoff-btn-${idModulo}`);
  if (!btn) return;
  btn.disabled = !DASH_RAW[idModulo];
}

function enviarHandoff(idModulo) {
  const dados = DASH_RAW[idModulo];
  if (!dados) return;
  // Sem origem/porta configurável nesta prova de conceito -- "*" é
  // deliberado aqui porque quem ENVIA o dado (este PWA) não corre risco
  // de vazamento: dimensionamento de torre não é sigiloso. A validação
  // que importa de verdade é do lado de QUEM RECEBE (o editor), que
  // precisa checar `event.origin` antes de aceitar -- ver
  // ESCOPO_ponte-hydrocalc-motor-novo_2026-09-11.md, seção "Mecanismo de
  // transporte".
  const mensagem = { tipo: "hydrocalc_dimensionamento", modulo: idModulo, dados };
  if (window.parent !== window) window.parent.postMessage(mensagem, "*");
  else if (window.opener) window.opener.postMessage(mensagem, "*");
}

document.addEventListener("DOMContentLoaded", () => {
  if (HANDOFF_MODULO && MODULOS_COM_HANDOFF.includes(HANDOFF_MODULO)) {
    irParaModulo(HANDOFF_MODULO);
  }
  if (HANDOFF_RETORNO) {
    MODULOS_COM_HANDOFF.forEach((id) => {
      const btn = document.getElementById(`handoff-btn-${id}`);
      if (btn) {
        btn.hidden = false;
        btn.addEventListener("click", () => enviarHandoff(id));
        atualizarBotaoHandoff(id);
      }
    });
  }
});

function renderDashboard() {
  const tbody = document.querySelector("#dash-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const linhas = [
    ["dw", "Darcy‑Weisbach — hf", DASH.dw],
    ["rede", "Rede Multitrecho — perda total", DASH.rede],
    ["bomba", "Bomba — ponto de operação", DASH.bomba],
    ["npsh", "NPSH — margem", DASH.npsh],
    ["econ", "Diâmetro econômico", DASH.econ],
    ["psv", "PSV — orifício requerido", DASH.psv],
    ["vaso", "Vaso de pressão — casco req.", DASH.vaso],
    ["troca", "Trocador — área requerida", DASH.troca],
    ["coluna", "Coluna — diâmetro (pratos)", DASH.coluna],
    ["comprr", "Compressor — potência", DASH.comprr],
    ["orif", "Orifício — vazão medida", DASH.orif],
    ["vapor", "Vapor — consumo/flash", DASH.vapor],
    ["agua", "Torre — reposição total", DASH.agua],
    ["forno", "Combustão — eficiência", DASH.forno],
    ["tanque", "Tanque — espessura costado", DASH.tanque],
    ["tanque", "Tanque — enquadramento NR-13", DASH.tanqueNr13],
    ["tanque", "Tanque — transbordamento", DASH.tanqueTransbordo],
    ["esp", "Espessura de Parede — raio JIP-33", DASH.jip33],
    ["flare", "Flare — diâmetro do header", DASH.flare],
    ["termico", "Térmico — vão máximo", DASH.termico],
    ["filtro", "Filtro — ΔP limpo", DASH.filtro],
    ["material", "Materiais — compatibilidade", DASH.material],
    ["material", "Materiais — risco de HTHA", DASH.htha],
    ["pulmao", "Tanque de Pulmão — volume mínimo", DASH.pulmao],
    ["balanco", "Balanço de Massa — fechamento", DASH.balanco],
    ["vpl", "Análise Econômica — VPL", DASH.vpl],
    ["capex", "CAPEX por Correlação — estimativa", DASH.capex],
    ["ventosas", "Ventosas e VAP — orifícios", DASH.ventosas],
    ["transientes", "Transientes — golpe de aríete", DASH.transientes],
  ];
  linhas.forEach(([id, label, val]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${label}</td><td>${val || "—"}</td>`;
    tr.addEventListener("click", () => irParaModulo(id));
    tbody.appendChild(tr);
  });
}

// ---------------- NPSH disponível + Leis de afinidade ----------------
function updateNpsh() {
  const patmKpa = parseFloat(document.getElementById("npsh-patm").value) || 0;
  const pvKpa = parseFloat(document.getElementById("npsh-pv").value) || 0;
  const rho = parseFloat(document.getElementById("npsh-rho").value) || 1;
  const hz = parseFloat(document.getElementById("npsh-hz").value) || 0;
  const hf = parseFloat(document.getElementById("npsh-hf").value) || 0;
  const npshr = parseFloat(document.getElementById("npsh-r").value) || 0;

  const npshd = ((patmKpa - pvKpa) * 1000) / (rho * G) + hz - hf;
  const margem = npshd - npshr;

  document.getElementById("npsh-d").textContent = `${npshd.toFixed(2)} m`;
  document.getElementById("npsh-margem").textContent = `${margem.toFixed(2)} m`;

  const alertEl = document.getElementById("npsh-alert");
  if (margem < 0) {
    alertEl.hidden = false;
    alertEl.textContent = `NPSHd menor que NPSHr — cavitação praticamente garantida. Reduza a perda de sucção, aumente Hz ou revise a bomba.`;
  } else if (margem < 0.6) {
    alertEl.hidden = false;
    alertEl.textContent = `Margem abaixo de 0,6 m — risco de cavitação intermitente. Prática recomendada (Hydraulic Institute) é margem ≥ 0,6 m ou NPSHd ≥ 1,1–1,3×NPSHr.`;
  } else {
    alertEl.hidden = true;
  }
  DASH.npsh = `margem ${margem.toFixed(2)} m`;
  renderDashboard();
}
["npsh-patm", "npsh-pv", "npsh-rho", "npsh-hz", "npsh-hf", "npsh-r"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateNpsh)
);

const afinTipo = document.getElementById("afin-tipo");
afinTipo.addEventListener("change", () => {
  const rot = afinTipo.value === "rotacao";
  document.getElementById("afin-n1-label").textContent = rot ? "Rotação original N1 (rpm)" : "Diâmetro original D1 (mm)";
  document.getElementById("afin-n2-label").textContent = rot ? "Rotação nova N2 (rpm)" : "Diâmetro novo D2 (mm)";
  updateAfin();
});

function updateAfin() {
  const n1 = parseFloat(document.getElementById("afin-n1").value) || 1;
  const n2 = parseFloat(document.getElementById("afin-n2").value) || 0;
  const q1 = parseFloat(document.getElementById("afin-q1").value) || 0;
  const h1 = parseFloat(document.getElementById("afin-h1").value) || 0;
  const p1 = parseFloat(document.getElementById("afin-p1").value) || 0;

  const r = n2 / n1;
  const q2 = q1 * r;
  const h2 = h1 * r ** 2;
  const p2 = p1 * r ** 3;

  document.getElementById("afin-q2").textContent = `${q2.toFixed(2)} L/min`;
  document.getElementById("afin-h2").textContent = `${h2.toFixed(2)} m`;
  document.getElementById("afin-p2").textContent = p1 > 0 ? `${p2.toFixed(3)} kW` : "—";
}
["afin-n1", "afin-n2", "afin-q1", "afin-h1", "afin-p1"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateAfin)
);

// ---------------- Diâmetro Econômico ----------------
const econFluido = document.getElementById("econ-fluido");
fillSelect(econFluido, FLUIDOS_PETROQ, "Óleo cru leve (~35 °API)");
econFluido.addEventListener("change", () => {
  document.getElementById("econ-rho").value = FLUIDOS_PETROQ[econFluido.value].rho;
  document.getElementById("econ-mu").value = FLUIDOS_PETROQ[econFluido.value].mu;
  updateEcon();
});
const econMat = document.getElementById("econ-mat");
fillSelect(econMat, RUGOSIDADE, "Aço galvanizado (novo)");
econMat.addEventListener("change", updateEcon);

function updateEcon() {
  const qM3h = parseFloat(document.getElementById("econ-q").value) || 0;
  const lM = parseFloat(document.getElementById("econ-l").value) || 1;
  const rho = parseFloat(document.getElementById("econ-rho").value) || 1;
  const muCp = parseFloat(document.getElementById("econ-mu").value) || 1;
  const rug = RUGOSIDADE[econMat.value];
  const eta = (parseFloat(document.getElementById("econ-eta").value) || 65) / 100;
  const horas = parseFloat(document.getElementById("econ-horas").value) || 0;
  const preco = parseFloat(document.getElementById("econ-preco").value) || 0;
  const coefTubo = parseFloat(document.getElementById("econ-coef").value) || 0;
  const taxa = (parseFloat(document.getElementById("econ-taxa").value) || 0) / 100;
  const vida = parseFloat(document.getElementById("econ-vida").value) || 1;

  const nu = (muCp * 1e-3) / rho;
  const qM3s = qM3h / 3600;
  const crf = taxa > 0 ? (taxa * (1 + taxa) ** vida) / ((1 + taxa) ** vida - 1) : 1 / vida;

  const curvaEnergia = [], curvaTubo = [], curvaTotal = [];
  let melhor = null;
  const dMinMm = 10, dMaxMm = 500, passos = 80;
  for (let i = 0; i <= passos; i++) {
    const dMm = dMinMm + ((dMaxMm - dMinMm) / passos) * i;
    const dM = dMm / 1000;
    const area = Math.PI * dM ** 2 / 4;
    const v = qM3s / area;
    const re = reynolds(v, dM, nu);
    const f = fatorAtritoColebrook(re, rug / dM);
    const hf = perdaDarcy(f, lM, dM, v);
    const potHid = rho * G * qM3s * hf;
    const potEixoKw = potHid / eta / 1000;
    const custoEnergia = potEixoKw * horas * preco;
    const custoTuboAnual = coefTubo * dMm * lM * crf;
    const total = custoEnergia + custoTuboAnual;

    curvaEnergia.push({ x: dMm, y: custoEnergia });
    curvaTubo.push({ x: dMm, y: custoTuboAnual });
    curvaTotal.push({ x: dMm, y: total });
    if (melhor === null || total < melhor.total) melhor = { dMm, total, v };
  }

  const comercial = DIAMETROS_COMERCIAIS_MM.find((d) => d >= melhor.dMm) || DIAMETROS_COMERCIAIS_MM[DIAMETROS_COMERCIAIS_MM.length - 1];

  document.getElementById("econ-dot").textContent = `${melhor.dMm.toFixed(1)} mm`;
  document.getElementById("econ-dcom").textContent = `${comercial} mm`;
  document.getElementById("econ-v").textContent = `${melhor.v.toFixed(2)} m/s`;
  document.getElementById("econ-total").textContent = `R$ ${melhor.total.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}/ano`;

  drawLineChart(
    document.getElementById("econ-chart"),
    [
      { points: curvaEnergia, color: "#B5722E" },
      { points: curvaTubo, color: "#0E4B43", dashed: true },
    ],
    [{ x: melhor.dMm, y: melhor.total, color: "#C4491D" }]
  );

  const alertEl = document.getElementById("econ-alert");
  if (melhor.v < 0.5 || melhor.v > 4) {
    alertEl.hidden = false;
    alertEl.textContent = `Velocidade no ótimo (${melhor.v.toFixed(2)} m/s) fora da faixa típica de projeto (0,5–4 m/s) — confira os parâmetros econômicos (custo de energia/tubo podem estar desbalanceados).`;
  } else {
    alertEl.hidden = true;
  }
  DASH.econ = `${comercial} mm (${melhor.v.toFixed(2)} m/s)`;
  renderDashboard();
}
["econ-q", "econ-l", "econ-rho", "econ-mu", "econ-eta", "econ-horas", "econ-preco", "econ-coef", "econ-taxa", "econ-vida"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateEcon)
);

// ---------------- Conversor de unidades ----------------
const convCat = document.getElementById("conv-cat");
const convDe = document.getElementById("conv-de");
const convPara = document.getElementById("conv-para");
Object.keys(CONVERSAO).forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat; opt.textContent = cat;
  convCat.appendChild(opt);
});

function popularUnidadesConv() {
  const fatores = CONVERSAO[convCat.value].fatores;
  const unidades = Object.keys(fatores);
  [convDe, convPara].forEach((sel) => {
    sel.innerHTML = "";
    unidades.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u; opt.textContent = u;
      sel.appendChild(opt);
    });
  });
  if (unidades.length > 1) convPara.selectedIndex = 1;
  updateConv();
}
convCat.addEventListener("change", popularUnidadesConv);

function updateConv() {
  const valor = parseFloat(document.getElementById("conv-valor").value) || 0;
  const cat = CONVERSAO[convCat.value];
  const fDe = cat.fatores[convDe.value];
  const fPara = cat.fatores[convPara.value];
  const resultado = (valor * fDe) / fPara;
  document.getElementById("conv-resultado").textContent = resultado.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}
["conv-de", "conv-para"].forEach((id) => document.getElementById(id).addEventListener("change", updateConv));
document.getElementById("conv-valor").addEventListener("input", updateConv);
popularUnidadesConv();

// ---------------- Vasos de Pressão (ASME VIII Div.1, UG-27/UG-32) ----------------
const vasoMatPreset = document.getElementById("vaso-mat-preset");
fillSelect(vasoMatPreset, MATERIAIS_ASME_VIII, "SA-516 Gr.70 (aço carbono, chapa)");
vasoMatPreset.addEventListener("change", () => {
  document.getElementById("vaso-s").value = MATERIAIS_ASME_VIII[vasoMatPreset.value];
  updateVaso();
});

function updateVaso() {
  const P = parseFloat(document.getElementById("vaso-p").value) || 0;
  const Di = parseFloat(document.getElementById("vaso-di").value) || 1;
  const R = Di / 2;
  const S = parseFloat(document.getElementById("vaso-s").value) || 1;
  const E = parseFloat(document.getElementById("vaso-e").value) || 1;
  const CA = parseFloat(document.getElementById("vaso-ca").value) || 0;

  const alertEl = document.getElementById("vaso-alert");
  const denomShell = S * E - 0.6 * P;
  const denomHead = 2 * S * E - 0.2 * P;
  if (denomShell <= 0 || denomHead <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Combinação de parâmetros inválida (denominador ≤ 0) — pressão excessiva para S·E informado.";
    ["vaso-t-shell", "vaso-t-shell-req", "vaso-t-head", "vaso-t-head-req"].forEach((id) => (document.getElementById(id).textContent = "—"));
  } else {
    alertEl.hidden = true;
    const tShell = (P * R) / denomShell;
    const tHead = (P * Di) / denomHead;
    document.getElementById("vaso-t-shell").textContent = `${tShell.toFixed(3)} mm`;
    document.getElementById("vaso-t-shell-req").textContent = `${(tShell + CA).toFixed(3)} mm`;
    document.getElementById("vaso-t-head").textContent = `${tHead.toFixed(3)} mm`;
    document.getElementById("vaso-t-head-req").textContent = `${(tHead + CA).toFixed(3)} mm`;
    DASH.vaso = `casco ${(tShell + CA).toFixed(1)} mm req.`;
    renderDashboard();
  }

  // Verificação de MAWP a partir de espessura existente
  const tExist = parseFloat(document.getElementById("vaso-t-existente").value) || 0;
  const tCorr = tExist - CA;
  const mawpAlert = document.getElementById("vaso-mawp-alert");
  if (tCorr <= 0) {
    mawpAlert.hidden = false;
    mawpAlert.textContent = "Espessura existente menor ou igual à sobrespessura de corrosão — nada de parede útil restante.";
    ["vaso-mawp", "vaso-mawp-shell", "vaso-mawp-head"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }
  const mawpShell = (S * E * tCorr) / (R + 0.6 * tCorr);
  const mawpHead = (2 * S * E * tCorr) / (Di + 0.2 * tCorr);
  const mawp = Math.min(mawpShell, mawpHead);
  document.getElementById("vaso-mawp-shell").textContent = `${mawpShell.toFixed(4)} MPa`;
  document.getElementById("vaso-mawp-head").textContent = `${mawpHead.toFixed(4)} MPa`;
  document.getElementById("vaso-mawp").textContent = `${mawp.toFixed(4)} MPa`;
  if (mawp < P) {
    mawpAlert.hidden = false;
    mawpAlert.textContent = `MAWP (${mawp.toFixed(3)} MPa) menor que a pressão de projeto (${P} MPa) — espessura existente insuficiente.`;
  } else {
    mawpAlert.hidden = true;
  }
}
["vaso-p", "vaso-di", "vaso-s", "vaso-ca", "vaso-t-existente"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateVaso)
);
document.getElementById("vaso-e").addEventListener("change", updateVaso);
updateVaso();

// ---------------- Trocadores de Calor (LMTD + fator F, TEMA 1-2) ----------------
function lmtdContracorrente(th1, th2, tc1, tc2) {
  const dT1 = th1 - tc2;
  const dT2 = th2 - tc1;
  if (dT1 <= 0 || dT2 <= 0) return null;
  if (Math.abs(dT1 - dT2) < 1e-6) return dT1;
  return (dT1 - dT2) / Math.log(dT1 / dT2);
}

function fatorF12(P, R) {
  if (P <= 0 || P >= 1 || P * R >= 1) return null;
  if (Math.abs(R - 1) < 1e-6) {
    const num = P * Math.SQRT2;
    const den = (1 - P) * Math.log((2 - P * (2 - Math.SQRT2)) / (2 - P * (2 + Math.SQRT2)));
    return num / den;
  }
  const sq = Math.sqrt(R * R + 1);
  const num = sq * Math.log((1 - P) / (1 - P * R));
  const a = 2 / P - 1 - R;
  const den = (R - 1) * Math.log((a + sq) / (a - sq));
  return num / den;
}

function updateTroca() {
  const th1 = parseFloat(document.getElementById("troca-th1").value) || 0;
  const th2 = parseFloat(document.getElementById("troca-th2").value) || 0;
  const tc1 = parseFloat(document.getElementById("troca-tc1").value) || 0;
  const tc2 = parseFloat(document.getElementById("troca-tc2").value) || 0;
  const arranjo = document.getElementById("troca-arranjo").value;
  const qKw = parseFloat(document.getElementById("troca-q").value) || 0;
  const U = parseFloat(document.getElementById("troca-u").value) || 1;

  const alertEl = document.getElementById("troca-alert");
  const lmtdCf = lmtdContracorrente(th1, th2, tc1, tc2);
  const R = tc2 !== tc1 ? (th1 - th2) / (tc2 - tc1) : null;
  const P = th1 !== tc1 ? (tc2 - tc1) / (th1 - tc1) : null;

  if (lmtdCf === null || R === null || P === null) {
    alertEl.hidden = false;
    alertEl.textContent = "Temperaturas inconsistentes (ΔT ≤ 0 em algum lado) — não há cruzamento térmico válido.";
    ["troca-area", "troca-lmtd", "troca-pr", "troca-f", "troca-lmtd-corr"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }

  document.getElementById("troca-lmtd").textContent = `${lmtdCf.toFixed(3)} K`;
  document.getElementById("troca-pr").textContent = `P=${P.toFixed(3)} / R=${R.toFixed(3)}`;

  let F = 1;
  if (arranjo === "1-2") {
    F = fatorF12(P, R);
    if (F === null) {
      alertEl.hidden = false;
      alertEl.textContent = "P·R ≥ 1 — cruzamento térmico, impossível com 1 casco / 2+ passes de tubo. Use 2+ cascos em série ou reduza P.";
      ["troca-area", "troca-f", "troca-lmtd-corr"].forEach((id) => (document.getElementById(id).textContent = "—"));
      return;
    }
  }
  const lmtdCorr = F * lmtdCf;
  const areaM2 = (qKw * 1000) / (U * lmtdCorr);

  document.getElementById("troca-f").textContent = F.toFixed(4);
  document.getElementById("troca-lmtd-corr").textContent = `${lmtdCorr.toFixed(3)} K`;
  document.getElementById("troca-area").textContent = `${areaM2.toFixed(2)} m²`;

  if (F < 0.75) {
    alertEl.hidden = false;
    alertEl.textContent = `F=${F.toFixed(3)} abaixo de 0,75 — configuração ineficiente, considerar 2 cascos em série (2-4 ou mais passes).`;
  } else {
    alertEl.hidden = true;
  }
  DASH.troca = `${areaM2.toFixed(1)} m² (F=${F.toFixed(2)})`;
  renderDashboard();
}
["troca-th1", "troca-th2", "troca-tc1", "troca-tc2", "troca-q", "troca-u"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateTroca)
);
document.getElementById("troca-arranjo").addEventListener("change", updateTroca);
updateTroca();

// ---------------- Colunas / Torres (inundação — pratos e recheio) ----------------
const colEspac = document.getElementById("col-espac");
fillSelect(colEspac, ESPACAMENTO_PRATOS, "450 mm (18\")");
colEspac.addEventListener("change", updateColuna);

function updateColuna() {
  // Pratos — Souders-Brown
  const qv = parseFloat(document.getElementById("col-qv").value) || 0;
  const csb = ESPACAMENTO_PRATOS[colEspac.value];
  const rhoV = parseFloat(document.getElementById("col-rhov").value) || 1;
  const rhoL = parseFloat(document.getElementById("col-rhol").value) || 1;
  const frac = (parseFloat(document.getElementById("col-frac").value) || 80) / 100;

  const pratoAlert = document.getElementById("col-prato-alert");
  if (rhoL <= rhoV) {
    pratoAlert.hidden = false;
    pratoAlert.textContent = "Densidade do líquido deve ser maior que a do vapor.";
    ["col-uflood", "col-udesign", "col-dmin-prato"].forEach((id) => (document.getElementById(id).textContent = "—"));
  } else {
    const uFlood = csb * Math.sqrt((rhoL - rhoV) / rhoV);
    const uDesign = uFlood * frac;
    const dMinPrato = Math.sqrt((4 * qv) / (Math.PI * uDesign));
    document.getElementById("col-uflood").textContent = `${uFlood.toFixed(3)} m/s`;
    document.getElementById("col-udesign").textContent = `${uDesign.toFixed(3)} m/s`;
    document.getElementById("col-dmin-prato").textContent = `${dMinPrato.toFixed(3)} m`;
    if (frac < 0.7 || frac > 0.85) {
      pratoAlert.hidden = false;
      pratoAlert.textContent = "Fração de projeto fora da faixa típica (70–85% da inundação) — confirme se é intencional.";
    } else {
      pratoAlert.hidden = true;
    }
    DASH.coluna = `Ø${dMinPrato.toFixed(2)} m (pratos)`;
    renderDashboard();
  }

  // Recheio — fator de capacidade Fs
  const dProp = parseFloat(document.getElementById("col-dprop").value) || 1;
  const fsMax = parseFloat(document.getElementById("col-tipo-recheio").value) || 2.2;
  const rhoV2 = rhoV;
  const area = (Math.PI * dProp ** 2) / 4;
  const uV = qv / area;
  const fs = uV * Math.sqrt(rhoV2);
  const uMax = fsMax / Math.sqrt(rhoV2);
  const dMinRecheio = Math.sqrt((4 * qv) / (Math.PI * uMax));

  document.getElementById("col-uv").textContent = `${uV.toFixed(3)} m/s`;
  document.getElementById("col-fs").textContent = `${fs.toFixed(3)} Pa⁰·⁵`;
  document.getElementById("col-dmin-recheio").textContent = `${dMinRecheio.toFixed(3)} m`;

  const recheioAlert = document.getElementById("col-recheio-alert");
  if (fs > fsMax) {
    recheioAlert.hidden = false;
    recheioAlert.textContent = `Fs (${fs.toFixed(2)}) acima do típico máximo (${fsMax}) — diâmetro proposto pequeno demais, risco de inundação/arraste excessivo.`;
  } else {
    recheioAlert.hidden = true;
  }
}
["col-qv", "col-rhov", "col-rhol", "col-frac", "col-dprop"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateColuna)
);
document.getElementById("col-tipo-recheio").addEventListener("change", updateColuna);
updateColuna();

// ---------------- Compressores (politrópico/isentrópico) ----------------
const comprrGas = document.getElementById("comprr-gas");
fillSelect(comprrGas, GASES, "Ar");
comprrGas.addEventListener("change", () => {
  document.getElementById("comprr-m").value = GASES[comprrGas.value].m;
  document.getElementById("comprr-k").value = GASES[comprrGas.value].k;
  updateComprr();
});

function updateComprr() {
  const M = parseFloat(document.getElementById("comprr-m").value) || 1;
  const k = parseFloat(document.getElementById("comprr-k").value) || 1.4;
  const p1 = parseFloat(document.getElementById("comprr-p1").value) || 0.01;
  const p2 = parseFloat(document.getElementById("comprr-p2").value) || 0.01;
  const t1C = parseFloat(document.getElementById("comprr-t1").value) || 0;
  const etaP = (parseFloat(document.getElementById("comprr-eta").value) || 1) / 100;
  const mDotKgH = parseFloat(document.getElementById("comprr-mdot").value) || 0;

  const alertEl = document.getElementById("comprr-alert");
  const rp = p2 / p1;
  const T1 = t1C + 273.15;

  if (rp <= 1 || k <= 1 || etaP <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Parâmetros inválidos — verifique P2>P1, k>1 e eficiência>0.";
    ["comprr-t2", "comprr-t2s", "comprr-rp", "comprr-n", "comprr-hp", "comprr-pot"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }

  const x = (k - 1) / (k * etaP);
  const n = 1 / (1 - x);
  const T2 = T1 * rp ** x;
  const T2s = T1 * rp ** ((k - 1) / k);
  const Hp = ((R_UNIV * T1) / M) * (1 / x) * (rp ** x - 1);
  const potenciaKw = ((mDotKgH / 3600) * Hp) / etaP / 1000;

  document.getElementById("comprr-rp").textContent = rp.toFixed(3);
  document.getElementById("comprr-n").textContent = n.toFixed(4);
  document.getElementById("comprr-t2").textContent = `${(T2 - 273.15).toFixed(1)} °C`;
  document.getElementById("comprr-t2s").textContent = `${(T2s - 273.15).toFixed(1)} °C`;
  document.getElementById("comprr-hp").textContent = `${(Hp / 1000).toFixed(2)} kJ/kg`;
  document.getElementById("comprr-pot").textContent = `${potenciaKw.toFixed(2)} kW`;

  const t2C = T2 - 273.15;
  if (t2C > 150) {
    alertEl.hidden = false;
    alertEl.textContent = `Temperatura de descarga (${t2C.toFixed(0)} °C) acima de 150 °C — típico limite prático de estágio único; avaliar resfriamento intermediário ou compressão em múltiplos estágios.`;
  } else if (rp > 5) {
    alertEl.hidden = false;
    alertEl.textContent = `Razão de compressão (${rp.toFixed(1)}) alta para estágio único — prática comum limita a ~3–5 por estágio; avaliar múltiplos estágios.`;
  } else {
    alertEl.hidden = true;
  }
  DASH.comprr = `${potenciaKw.toFixed(1)} kW (T2=${t2C.toFixed(0)}°C)`;
  renderDashboard();
}
["comprr-m", "comprr-k", "comprr-p1", "comprr-p2", "comprr-t1", "comprr-eta", "comprr-mdot"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateComprr)
);
updateComprr();

// ---------------- Medição de Vazão (ISO 5167 — placa de orifício) ----------------
const orifFluido = document.getElementById("orif-fluido");
const orifGasFields = document.getElementById("orif-gas-fields");
orifFluido.addEventListener("change", () => {
  orifGasFields.hidden = orifFluido.value !== "gas";
  updateOrif();
});

function updateOrif() {
  const D = parseFloat(document.getElementById("orif-d-tubo").value) || 1;
  const d = parseFloat(document.getElementById("orif-d-orif").value) || 0.1;
  const dpKpa = parseFloat(document.getElementById("orif-dp").value) || 0;
  const rho1 = parseFloat(document.getElementById("orif-rho").value) || 0.001;
  const C = parseFloat(document.getElementById("orif-c").value) || 0.6;

  const alertEl = document.getElementById("orif-alert");
  const beta = d / D;

  let eps = 1;
  if (orifFluido.value === "gas") {
    const p1Kpa = parseFloat(document.getElementById("orif-p1").value) || 1;
    const kGas = parseFloat(document.getElementById("orif-kgas").value) || 1.4;
    const p2Kpa = p1Kpa - dpKpa;
    if (p2Kpa <= 0 || p1Kpa <= 0) {
      eps = null;
    } else {
      const coef = 0.351 + 0.256 * beta ** 4 + 0.93 * beta ** 8;
      eps = 1 - coef * (1 - (p2Kpa / p1Kpa) ** (1 / kGas));
    }
  }

  if (beta <= 0.1 || beta >= 0.75) {
    alertEl.hidden = false;
    alertEl.textContent = `β=${beta.toFixed(3)} fora da faixa validada pela ISO 5167-2 (0,10–0,75) — resultado fora do escopo da norma.`;
  } else {
    alertEl.hidden = true;
  }

  if (eps === null || dpKpa < 0) {
    document.getElementById("orif-qm").textContent = "—";
    document.getElementById("orif-qv").textContent = "—";
    document.getElementById("orif-eps").textContent = "—";
    document.getElementById("orif-beta").textContent = beta.toFixed(3);
    alertEl.hidden = false;
    alertEl.textContent = "Pressão a jusante (P1−ΔP) inválida — revise P1 e ΔP.";
    return;
  }

  const areaM2 = (Math.PI / 4) * (d / 1000) ** 2;
  const qmKgs = (C / Math.sqrt(1 - beta ** 4)) * eps * areaM2 * Math.sqrt(2 * dpKpa * 1000 * rho1);
  const qvM3h = (qmKgs / rho1) * 3600;

  document.getElementById("orif-beta").textContent = beta.toFixed(3);
  document.getElementById("orif-eps").textContent = eps.toFixed(4);
  document.getElementById("orif-qm").textContent = `${(qmKgs * 3600).toFixed(2)} kg/h`;
  document.getElementById("orif-qv").textContent = `${qvM3h.toFixed(3)} m³/h`;
  DASH.orif = `${(qmKgs * 3600).toFixed(1)} kg/h (β=${beta.toFixed(2)})`;
  renderDashboard();
}
["orif-d-tubo", "orif-d-orif", "orif-dp", "orif-rho", "orif-c", "orif-p1", "orif-kgas"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateOrif)
);
updateOrif();

// ---------------- Vapor / Condensado ----------------
function updateVapor() {
  const pBar = parseFloat(document.getElementById("vapor-p").value) || 0.1;
  const [tsat, hf, hfg, hg, vg] = vaporSaturadoInterp(pBar);
  document.getElementById("vapor-tsat").textContent = `${tsat.toFixed(1)} °C`;
  document.getElementById("vapor-hf").textContent = `${hf.toFixed(1)} kJ/kg`;
  document.getElementById("vapor-hfg").textContent = `${hfg.toFixed(1)} kJ/kg`;
  document.getElementById("vapor-hg").textContent = `${hg.toFixed(1)} kJ/kg`;
  document.getElementById("vapor-vg").textContent = `${vg.toFixed(4)} m³/kg`;

  const qKw = parseFloat(document.getElementById("vapor-q").value) || 0;
  const mVaporKgH = (qKw / hfg) * 3600;
  document.getElementById("vapor-mvapor").textContent = `${mVaporKgH.toFixed(1)} kg/h`;

  // Flash
  const p1 = parseFloat(document.getElementById("vapor-p1flash").value) || 0.1;
  const p2 = parseFloat(document.getElementById("vapor-p2flash").value) || 0.1;
  const mCond = parseFloat(document.getElementById("vapor-mcond").value) || 0;
  const alertEl = document.getElementById("vapor-alert");

  if (p2 >= p1) {
    alertEl.hidden = false;
    alertEl.textContent = "A pressão de flash P2 deve ser menor que a pressão de montante P1.";
    document.getElementById("vapor-flash-frac").textContent = "—";
    document.getElementById("vapor-flash-vazao").textContent = "—";
  } else {
    alertEl.hidden = true;
    const [, hf1] = vaporSaturadoInterp(p1);
    const [, hf2, hfg2] = vaporSaturadoInterp(p2);
    const fracFlash = (hf1 - hf2) / hfg2;
    document.getElementById("vapor-flash-frac").textContent = `${(fracFlash * 100).toFixed(2)} %`;
    document.getElementById("vapor-flash-vazao").textContent = `${(fracFlash * mCond).toFixed(1)} kg/h`;
  }
  DASH.vapor = `${mVaporKgH.toFixed(0)} kg/h @ ${pBar} bar`;
  renderDashboard();
}
["vapor-p", "vapor-q", "vapor-p1flash", "vapor-p2flash", "vapor-mcond"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateVapor)
);
updateVapor();

// ---------------- Água de Resfriamento (balanço térmico de torre) ----------------
function updateAgua() {
  const L = parseFloat(document.getElementById("agua-l").value) || 0;
  const tin = parseFloat(document.getElementById("agua-tin").value) || 0;
  const tout = parseFloat(document.getElementById("agua-tout").value) || 0;
  const coc = parseFloat(document.getElementById("agua-coc").value) || 1.5;
  const driftPct = (parseFloat(document.getElementById("agua-drift").value) || 0) / 100;

  const alertEl = document.getElementById("agua-alert");
  const dT = tin - tout;
  if (dT <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "A temperatura de entrada (quente) deve ser maior que a de saída (fria).";
    ["agua-makeup", "agua-q", "agua-evap", "agua-purga", "agua-arraste"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }
  if (coc <= 1) {
    alertEl.hidden = false;
    alertEl.textContent = "Ciclos de concentração deve ser maior que 1.";
    ["agua-makeup", "agua-q", "agua-evap", "agua-purga", "agua-arraste"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }

  const rho = 1000;
  const cp = 4.186;
  const qKw = (L * rho * cp * dT) / 3600;
  const evap = 0.00153 * L * dT;
  const arraste = driftPct * L;
  const purgaCorreta = evap / (coc - 1);
  const makeup = evap + purgaCorreta + arraste;

  document.getElementById("agua-q").textContent = `${qKw.toFixed(0)} kW`;
  document.getElementById("agua-evap").textContent = `${evap.toFixed(2)} m³/h`;
  document.getElementById("agua-purga").textContent = `${purgaCorreta.toFixed(2)} m³/h`;
  document.getElementById("agua-arraste").textContent = `${arraste.toFixed(2)} m³/h`;
  document.getElementById("agua-makeup").textContent = `${makeup.toFixed(2)} m³/h`;

  if (dT > 15) {
    alertEl.hidden = false;
    alertEl.textContent = `Range (${dT.toFixed(1)}°C) alto para torre convencional — verifique se o dado está correto ou se há reaproveitamento térmico adicional.`;
  } else {
    alertEl.hidden = true;
  }
  DASH.agua = `${makeup.toFixed(1)} m³/h reposição`;
  renderDashboard();
}
["agua-l", "agua-tin", "agua-tout", "agua-coc", "agua-drift"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateAgua)
);
updateAgua();

// ---------------- Fornos / Caldeiras (eficiência de combustão, Siegert) ----------------
const fornoComb = document.getElementById("forno-comb");
fillSelect(fornoComb, COMBUSTIVEIS_SIEGERT, "Gás natural");
fornoComb.addEventListener("change", updateForno);

function updateForno() {
  const { A2, B } = COMBUSTIVEIS_SIEGERT[fornoComb.value];
  const tgas = parseFloat(document.getElementById("forno-tgas").value) || 0;
  const tar = parseFloat(document.getElementById("forno-tar").value) || 0;
  const o2 = parseFloat(document.getElementById("forno-o2").value) || 0.1;
  const outras = parseFloat(document.getElementById("forno-outras").value) || 0;

  const alertEl = document.getElementById("forno-alert");
  if (o2 >= 21) {
    alertEl.hidden = false;
    alertEl.textContent = "O₂ medido inválido (deve ser menor que 21%).";
    document.getElementById("forno-eta").textContent = "—";
    document.getElementById("forno-perda-gases").textContent = "—";
    return;
  }

  const qA = (tgas - tar) * (A2 / (21 - o2) + B);
  const eta = 100 - qA - outras;
  document.getElementById("forno-perda-gases").textContent = `${qA.toFixed(2)} %`;
  document.getElementById("forno-eta").textContent = `${eta.toFixed(2)} %`;

  if (o2 < 1 || o2 > 8) {
    alertEl.hidden = false;
    alertEl.textContent = `O₂ (${o2}%) fora da faixa típica de boa combustão (1–8%) — verifique excesso de ar ou a medição.`;
  } else if (eta < 80) {
    alertEl.hidden = false;
    alertEl.textContent = `Eficiência (${eta.toFixed(1)}%) baixa — avaliar ajuste de excesso de ar ou recuperação de calor dos gases.`;
  } else {
    alertEl.hidden = true;
  }
  DASH.forno = `η=${eta.toFixed(1)}%`;
  renderDashboard();
}
["forno-tgas", "forno-tar", "forno-o2", "forno-outras"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateForno)
);
updateForno();

// ---------------- Tanques (API 650 — método de 1 pé) ----------------
function updateTanque() {
  const D = parseFloat(document.getElementById("tanque-d").value) || 0.1;
  const H = parseFloat(document.getElementById("tanque-h").value) || 0.31;
  const G = parseFloat(document.getElementById("tanque-g").value) || 0.1;
  const CA = parseFloat(document.getElementById("tanque-ca").value) || 0;
  const Sd = parseFloat(document.getElementById("tanque-sd").value) || 1;
  const St = parseFloat(document.getElementById("tanque-st").value) || 1;

  const alertEl = document.getElementById("tanque-alert");
  if (H <= 0.3) {
    alertEl.hidden = false;
    alertEl.textContent = "Nível de projeto H deve ser maior que 0,3 m (o método de 1 pé subtrai 0,3 m do nível).";
    ["tanque-td", "tanque-tt", "tanque-t-final", "tanque-vol"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }
  alertEl.hidden = true;

  const td = (4.9 * D * (H - 0.3) * G) / Sd + CA;
  const tt = (4.9 * D * (H - 0.3)) / St;
  const tFinal = Math.max(td, tt);
  const vol = (Math.PI / 4) * D ** 2 * H;

  document.getElementById("tanque-td").textContent = `${td.toFixed(3)} mm`;
  document.getElementById("tanque-tt").textContent = `${tt.toFixed(3)} mm`;
  document.getElementById("tanque-t-final").textContent = `${tFinal.toFixed(3)} mm`;
  document.getElementById("tanque-vol").textContent = `${vol.toFixed(1)} m³`;

  // Reverso: espessura existente -> altura máxima
  const tExist = parseFloat(document.getElementById("tanque-t-existente").value) || 0;
  const hAlert = document.getElementById("tanque-h-alert");
  const tDisponivel = tExist - CA;
  if (tDisponivel <= 0) {
    hAlert.hidden = false;
    hAlert.textContent = "Espessura existente menor ou igual à sobrespessura de corrosão.";
    document.getElementById("tanque-h-max").textContent = "—";
  } else {
    const hMax = (tDisponivel * Sd) / (4.9 * D * G) + 0.3;
    document.getElementById("tanque-h-max").textContent = `${hMax.toFixed(3)} m`;
    hAlert.hidden = true;
  }
  DASH.tanque = `${tFinal.toFixed(1)} mm costado`;

  // Enquadramento NR-13 (Sprint H7) — reaproveita D e vol já calculados acima.
  // NR-13 não tem Categoria I-V para tanques (isso é exclusivo de vasos de pressão);
  // para tanques o critério é ENQUADRAMENTO: diâmetro >3m + capacidade >20.000L (20 m³)
  // + fluido classe A ou B, simultaneamente (itens 13.2.1-f, 13.7, 13.5.1.2-a).
  const classe = document.getElementById("tanque-nr13-classe").value;
  const enquadra = D > 3 && vol > 20 && (classe === "A" || classe === "B");
  const resultEl = document.getElementById("tanque-nr13-resultado");
  const msgEl = document.getElementById("tanque-nr13-msg");
  resultEl.textContent = enquadra ? "SIM — exige plano de inspeção" : "NÃO — fora do escopo";
  msgEl.hidden = false;
  msgEl.textContent = enquadra
    ? "Enquadrado na NR-13 (diâmetro >3 m, capacidade >20.000 L e fluido classe A/B): elabore programa e plano de inspeção formal (item 13.7), com dispositivos de segurança contra sobrepressão e vácuo."
    : "Fora do escopo de inspeção da NR-13 para tanques (não atende a uma ou mais das 3 condições simultâneas). Siga API 650/2000 por boas práticas, mesmo sem exigência formal da norma trabalhista.";
  DASH.tanqueNr13 = enquadra ? "NR-13: SIM — exige plano de inspeção" : "NR-13: NÃO — fora do escopo";

  // Alerta de Transbordamento (Sprint H8) — triagem simplificada 90%/95% sobre a
  // altura TOTAL do casco (capacidade física real), independente do nível de
  // projeto H usado acima. Limiares não são valor normativo fixo (ver API 2350).
  const cascoTotal = parseFloat(document.getElementById("tanque-transbordo-casco").value) || 0.1;
  const nivelAtual = parseFloat(document.getElementById("tanque-transbordo-nivel").value) || 0;
  const pctEnchimento = (nivelAtual / cascoTotal) * 100;
  const folgaCasco = cascoTotal - nivelAtual;
  const transbResultEl = document.getElementById("tanque-transbordo-resultado");
  const transbMsgEl = document.getElementById("tanque-transbordo-msg");
  document.getElementById("tanque-transbordo-pct").textContent = `${pctEnchimento.toFixed(1)} %`;
  document.getElementById("tanque-transbordo-folga").textContent = `${folgaCasco.toFixed(2)} m`;
  transbMsgEl.hidden = false;
  if (pctEnchimento >= 95) {
    transbResultEl.textContent = "CRÍTICO";
    transbMsgEl.textContent = "Nível ≥ 95% da capacidade física do casco: risco iminente de transbordamento. Interrompa o enchimento e acione o procedimento de emergência (API 2350) imediatamente.";
  } else if (pctEnchimento >= 90) {
    transbResultEl.textContent = "ATENÇÃO";
    transbMsgEl.textContent = "Nível entre 90% e 95% da capacidade física do casco: aproximando-se do limite de transbordamento. Reduza/prepare para interromper o enchimento e confirme o alarme de nível alto (HHL) do instrumento.";
  } else {
    transbResultEl.textContent = "OK";
    transbMsgEl.textContent = "Nível abaixo de 90% da capacidade física do casco.";
  }
  DASH.tanqueTransbordo = `Transbordamento: ${transbResultEl.textContent} (${pctEnchimento.toFixed(1)}%)`;
  renderDashboard();
}
["tanque-d", "tanque-h", "tanque-g", "tanque-ca", "tanque-sd", "tanque-st", "tanque-t-existente", "tanque-nr13-classe", "tanque-transbordo-casco", "tanque-transbordo-nivel"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateTanque)
);
updateTanque();

// ---------------- Flare / Header (API 521 — limite de Mach) ----------------
const flareGas = document.getElementById("flare-gas");
fillSelect(flareGas, GASES, "Propano (C3H8)");
flareGas.addEventListener("change", () => {
  document.getElementById("flare-m").value = GASES[flareGas.value].m;
  document.getElementById("flare-k").value = GASES[flareGas.value].k;
  updateFlare();
});

function updateFlare() {
  const M = parseFloat(document.getElementById("flare-m").value) || 1;
  const k = parseFloat(document.getElementById("flare-k").value) || 1.4;
  const mDotKgH = parseFloat(document.getElementById("flare-vazao").value) || 0;
  const machLimit = parseFloat(document.getElementById("flare-mach").value) || 0.5;
  const pKpa = parseFloat(document.getElementById("flare-p").value) || 1;
  const tC = parseFloat(document.getElementById("flare-t").value) || 0;

  const alertEl = document.getElementById("flare-alert");
  const T = tC + 273.15;
  const Z = 1;

  if (M <= 0 || k <= 1 || pKpa <= 0 || T <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Parâmetros inválidos — verifique M, k, pressão e temperatura.";
    ["flare-dmin", "flare-csonica", "flare-vmax"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }

  const c = Math.sqrt((k * Z * R_UNIV * T) / M);
  const vMax = machLimit * c;
  const rho = (pKpa * 1000 * M) / (Z * R_UNIV * T);
  const Q = mDotKgH / 3600 / rho;
  const aMin = Q / vMax;
  const dMinMm = Math.sqrt((4 * aMin) / Math.PI) * 1000;

  document.getElementById("flare-csonica").textContent = `${c.toFixed(1)} m/s`;
  document.getElementById("flare-vmax").textContent = `${vMax.toFixed(1)} m/s`;
  document.getElementById("flare-dmin").textContent = `${dMinMm.toFixed(1)} mm`;
  alertEl.hidden = true;

  // Verificação de diâmetro proposto
  const dPropMm = parseFloat(document.getElementById("flare-d-prop").value) || 1;
  const dPropM = dPropMm / 1000;
  const aProp = (Math.PI / 4) * dPropM ** 2;
  const vReal = Q / aProp;
  const machReal = vReal / c;

  document.getElementById("flare-v-real").textContent = `${vReal.toFixed(1)} m/s`;
  document.getElementById("flare-mach-real").textContent = machReal.toFixed(4);

  if (machReal > machLimit) {
    alertEl.hidden = false;
    alertEl.textContent = `Mach real (${machReal.toFixed(3)}) excede o limite (${machLimit}) — diâmetro proposto (${dPropMm} mm) insuficiente, mínimo recomendado ${dMinMm.toFixed(0)} mm.`;
  }
  DASH.flare = `Ø${dMinMm.toFixed(0)} mm mín.`;
  renderDashboard();
}
["flare-m", "flare-k", "flare-vazao", "flare-mach", "flare-p", "flare-t", "flare-d-prop"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateFlare)
);
updateFlare();

// ---------------- Suportes / Expansão Térmica / Isolamento ----------------
function updateTermVao() {
  const Do = parseFloat(document.getElementById("term-do").value) || 1;
  const t = parseFloat(document.getElementById("term-t").value) || 0.1;
  const w = parseFloat(document.getElementById("term-w").value) || 0.1;
  const deltaMm = parseFloat(document.getElementById("term-delta").value) || 0.1;
  const eGpa = parseFloat(document.getElementById("term-e").value) || 1;

  const alertEl = document.getElementById("term-alert");
  const Di = Do - 2 * t;
  if (Di <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Espessura excede o raio — diâmetro interno inválido.";
    document.getElementById("term-lmax").textContent = "—";
    document.getElementById("term-inercia").textContent = "—";
    return;
  }
  alertEl.hidden = true;

  const DoM = Do / 1000;
  const DiM = Di / 1000;
  const I = (Math.PI / 64) * (DoM ** 4 - DiM ** 4); // m^4
  const E = eGpa * 1e9; // Pa
  const wN = w * 9.81; // N/m
  const deltaM = deltaMm / 1000;
  const Lmax = ((384 * E * I * deltaM) / (5 * wN)) ** 0.25;

  document.getElementById("term-inercia").textContent = `${(I * 1e8).toFixed(3)} cm⁴`;
  document.getElementById("term-lmax").textContent = `${Lmax.toFixed(2)} m`;
  DASH.termico = `vão ${Lmax.toFixed(1)} m`;
  renderDashboard();
}
["term-do", "term-t", "term-w", "term-delta", "term-e"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateTermVao)
);
updateTermVao();

const termMat = document.getElementById("term-mat");
fillSelect(termMat, MATERIAIS_DILATACAO, "Aço carbono");
termMat.addEventListener("change", () => {
  document.getElementById("term-alpha").value = MATERIAIS_DILATACAO[termMat.value];
  updateTermExpansao();
});

function updateTermExpansao() {
  const alpha = parseFloat(document.getElementById("term-alpha").value) || 0;
  const L = parseFloat(document.getElementById("term-l").value) || 0;
  const dT = parseFloat(document.getElementById("term-dt").value) || 0;
  const dL = alpha * L * dT;
  document.getElementById("term-dl").textContent = `${dL.toFixed(1)} mm`;
}
["term-alpha", "term-l", "term-dt"].forEach((id) => document.getElementById(id).addEventListener("input", updateTermExpansao));
updateTermExpansao();

const termIsol = document.getElementById("term-isol");
fillSelect(termIsol, ISOLANTES, "Lã de rocha/mineral");
termIsol.addEventListener("change", () => {
  document.getElementById("term-k-isol").value = ISOLANTES[termIsol.value];
  updateTermIsolamento();
});

function updateTermIsolamento() {
  const Do = parseFloat(document.getElementById("term-do").value) || 1;
  const kIsol = parseFloat(document.getElementById("term-k-isol").value) || 0.001;
  const espIsolMm = parseFloat(document.getElementById("term-esp-isol").value) || 1;
  const tint = parseFloat(document.getElementById("term-tint").value) || 0;
  const tamb = parseFloat(document.getElementById("term-tamb").value) || 0;
  const h = parseFloat(document.getElementById("term-h").value) || 1;

  const alertEl = document.getElementById("term-isol-alert");
  const r1 = Do / 2 / 1000;
  const r2 = r1 + espIsolMm / 1000;
  const Rcond = Math.log(r2 / r1) / (2 * Math.PI * kIsol);
  const Rconv = 1 / (2 * Math.PI * r2 * h);
  const QL = (tint - tamb) / (Rcond + Rconv);
  const Tsup = tamb + QL * Rconv;

  document.getElementById("term-ql").textContent = `${QL.toFixed(2)} W/m`;
  document.getElementById("term-tsup").textContent = `${Tsup.toFixed(1)} °C`;

  if (Tsup > 60) {
    alertEl.hidden = false;
    alertEl.textContent = `Temperatura de superfície (${Tsup.toFixed(0)}°C) acima de 60°C — risco de queimadura ao toque, considerar aumentar a espessura do isolamento.`;
  } else {
    alertEl.hidden = true;
  }
}
["term-k-isol", "term-esp-isol", "term-tint", "term-tamb", "term-h", "term-do"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateTermIsolamento)
);
updateTermIsolamento();

// ---------------- Filtros ----------------
const filtroTipo = document.getElementById("filtro-tipo");
fillSelect(filtroTipo, FILTROS_K, "Cesto (basket strainer)");
filtroTipo.addEventListener("change", () => {
  document.getElementById("filtro-k").value = FILTROS_K[filtroTipo.value];
  updateFiltro();
});

function updateFiltro() {
  const K = parseFloat(document.getElementById("filtro-k").value) || 0.01;
  const D = parseFloat(document.getElementById("filtro-d").value) || 1;
  const Q = parseFloat(document.getElementById("filtro-q").value) || 0;
  const rho = parseFloat(document.getElementById("filtro-rho").value) || 1;

  const areaM2 = (Math.PI / 4) * (D / 1000) ** 2;
  const v = Q / 3600 / areaM2;
  const dP0Pa = K * rho * v ** 2 / 2;
  const dP0Kpa = dP0Pa / 1000;

  document.getElementById("filtro-v").textContent = `${v.toFixed(3)} m/s`;
  document.getElementById("filtro-dp0").textContent = `${dP0Kpa.toFixed(3)} kPa`;

  const dpAtual = parseFloat(document.getElementById("filtro-dp-atual").value) || 0;
  const dpMax = parseFloat(document.getElementById("filtro-dp-max").value) || 1;
  const alertEl = document.getElementById("filtro-alert");
  if (dpMax <= dP0Kpa) {
    alertEl.hidden = false;
    alertEl.textContent = "ΔP máximo admissível deve ser maior que o ΔP do elemento limpo.";
    document.getElementById("filtro-colmat").textContent = "—";
  } else {
    const colmat = ((dpAtual - dP0Kpa) / (dpMax - dP0Kpa)) * 100;
    document.getElementById("filtro-colmat").textContent = `${colmat.toFixed(1)} %`;
    if (colmat >= 100) {
      alertEl.hidden = false;
      alertEl.textContent = "ΔP atual igual ou acima do máximo admissível — troca do elemento necessária.";
    } else if (colmat >= 80) {
      alertEl.hidden = false;
      alertEl.textContent = "Colmatação acima de 80% — programar troca em breve.";
    } else {
      alertEl.hidden = true;
    }
  }
  DASH.filtro = `ΔP limpo ${dP0Kpa.toFixed(2)} kPa`;
  renderDashboard();
}
["filtro-k", "filtro-d", "filtro-q", "filtro-rho", "filtro-dp-atual", "filtro-dp-max"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateFiltro)
);
updateFiltro();

// ---------------- Materiais / Corrosão ----------------
const matFluido = document.getElementById("mat-fluido");
const matMaterial = document.getElementById("mat-material");
Object.keys(COMPATIBILIDADE).forEach((f) => {
  const opt = document.createElement("option");
  opt.value = f;
  opt.textContent = f;
  matFluido.appendChild(opt);
});
const primeiroFluido = Object.keys(COMPATIBILIDADE)[0];
Object.keys(COMPATIBILIDADE[primeiroFluido]).forEach((m) => {
  const opt = document.createElement("option");
  opt.value = m;
  opt.textContent = m;
  matMaterial.appendChild(opt);
});

function updateMaterial() {
  const fluido = matFluido.value;
  const material = matMaterial.value;
  const entrada = COMPATIBILIDADE[fluido] && COMPATIBILIDADE[fluido][material];
  const ratingEl = document.getElementById("mat-rating");
  const notaEl = document.getElementById("mat-nota");
  if (!entrada) {
    ratingEl.textContent = "—";
    notaEl.hidden = true;
    return;
  }
  const [rating, nota] = entrada;
  ratingEl.textContent = rating;
  notaEl.hidden = false;
  notaEl.textContent = nota;
  DASH.material = `${material} × ${fluido}: ${rating}`;
  renderDashboard();
}
matFluido.addEventListener("change", updateMaterial);
matMaterial.addEventListener("change", updateMaterial);
updateMaterial();

// ---------------- Triagem de HTHA (Sprint H6) ----------------
// Limiar único de triagem (aço carbono + H2 + T>204°C/~400°F) — não é a
// curva de Nelson real (API RP 941, paga; depende também da pressão
// parcial de H2 e varia por liga). Referência cruzada: caso Tesoro
// Anacortes (Diagnóstico/G2, Tier 1/G4).
const LIMIAR_HTHA_C = 204;
function updateHtha() {
  const h2 = document.getElementById("htha-h2").value === "sim";
  const temp = parseFloat(document.getElementById("htha-temp").value) || 0;
  const acoCarbono = document.getElementById("htha-material").value === "sim";
  const alertEl = document.getElementById("htha-alert");
  const okEl = document.getElementById("htha-ok");

  if (h2 && acoCarbono && temp > LIMIAR_HTHA_C) {
    alertEl.hidden = false;
    okEl.hidden = true;
    alertEl.textContent = `ATENÇÃO — condição de risco de HTHA: aço carbono + H2 + temperatura acima de ${LIMIAR_HTHA_C}°C. Consultar a curva de Nelson real (API RP 941) para o teor de liga e pressão parcial de H2 do serviço antes de aprovar este material — não operar só com base neste limiar simplificado.`;
    DASH.htha = "ATENÇÃO — risco de HTHA";
  } else if (h2 && acoCarbono) {
    alertEl.hidden = false;
    okEl.hidden = true;
    alertEl.textContent = `OK — H2 presente, mas temperatura de operação abaixo do limiar de triagem (${LIMIAR_HTHA_C}°C); reavaliar se a temperatura mudar.`;
    DASH.htha = "OK (H2 presente, T abaixo do limiar)";
  } else {
    alertEl.hidden = true;
    okEl.hidden = false;
    DASH.htha = "OK — sem risco de HTHA indicado";
  }
  renderDashboard();
}
["htha-h2", "htha-temp", "htha-material"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateHtha);
  document.getElementById(id).addEventListener("change", updateHtha);
});
updateHtha();

// Diagnóstico por sintoma — causas prováveis mais comuns, não exaustivo.
// Cada causa: [texto, id do módulo relacionado ou null se fora do escopo de cálculo]
const DIAGNOSTICO = {
  "Cavitação / pressão de sucção da bomba baixa": [
    ["NPSH disponível insuficiente para o NPSH requerido pela bomba", "npsh"],
    ["Perda de carga na linha de sucção maior que a projetada", "dw"],
    ["Filtro/coador de sucção colmatado", "filtro"],
    ["Entrada de ar na sucção (flange, selo, nível baixo no tanque) — inspeção física, fora do escopo de cálculo", null],
  ],
  "Vazão da bomba abaixo do esperado": [
    ["Ponto de operação real deslocado da curva (rede exige mais carga que o projeto)", "bomba"],
    ["Perda de carga da rede maior que a assumida no projeto", "rede"],
    ["Diâmetro de linha subdimensionado frente à vazão real", "econ"],
    ["Desgaste do rotor/folgas internas da bomba — inspeção mecânica, fora do escopo de cálculo", null],
  ],
  "PSV disparando com frequência ou vazando": [
    ["Orifício de alívio subdimensionado para o cenário de contingência real", "psv"],
    ["Contrapressão do header de alívio excessiva para o tipo de PSV", "flare"],
    ["Pressão de ajuste próxima da pressão normal de operação (margem insuficiente) — revisar set point", null],
  ],
  "Queda de pressão na linha maior que o projetado": [
    ["Rugosidade real da tubulação maior que a assumida (incrustação/corrosão interna)", "dw"],
    ["Diâmetro econômico original mal dimensionado para a vazão atual", "econ"],
    ["Acessórios/válvulas não contabilizados no ΣK original", "sk"],
    ["Filtro ou coador em linha colmatado", "filtro"],
  ],
  "Temperatura de descarga do compressor alta": [
    ["Razão de compressão do estágio acima do projetado", "comprr"],
    ["Eficiência politrópica real menor que a de projeto (desgaste/sujidade)", "comprr"],
    ["Estágio único sendo usado além do limite prático de razão de compressão", "comprr"],
  ],
  "Colmatação rápida do elemento filtrante": [
    ["Acompanhar tendência de ΔP para estimar quando trocar", "filtro"],
    ["Material do elemento incompatível com o fluido, gerando incrustação/ataque químico", "material"],
  ],
  "Vazão medida por placa de orifício divergente do esperado": [
    ["β (relação d/D) fora da faixa validada pela norma ou instalação incorreta", "orif"],
    ["Densidade ou condições de processo assumidas diferentes das reais", "orif"],
    ["Tomadas de pressão obstruídas ou linhas de impulso com problema — inspeção física, fora do escopo de cálculo", null],
  ],
  "Corrosão ou vazamento prematuro em linha/equipamento": [
    ["Material incompatível com o fluido de processo real (concentração/temperatura)", "material"],
    ["Sobrespessura de corrosão subestimada no projeto original", "esp"],
    ["Vaso de pressão com espessura insuficiente para a pressão atual — verificar MAWP", "vaso"],
  ],
  "Superfície de tubulação isolada muito quente ao toque": [
    ["Espessura de isolamento insuficiente para a temperatura de processo", "termico"],
    ["Isolante degradado, comprimido ou molhado — inspeção física, fora do escopo de cálculo", null],
  ],
  "Torre de resfriamento consumindo água de reposição em excesso": [
    ["Range (ΔT) maior que o projetado — verificar carga térmica real", "agua"],
    ["Ciclos de concentração baixos, aumentando a purga necessária", "agua"],
    ["Arraste (drift) elevado por defeito no eliminador de gotas — inspeção física, fora do escopo de cálculo", null],
  ],
};

// Sprint G2 — Bloco B: casos reais documentados (não exaustivo, amostra de padrões
// recorrentes de causa raiz). Mesmo conteúdo do Bloco B da aba "Diagnóstico de
// Problemas" na planilha — fontes: CSB.gov (EUA), Havtil (Noruega), imprensa/nota
// sindical (Brasil, sem relatório técnico público completo equivalente).
const CASOS_REAIS = [
  {
    caso: "Tesoro Anacortes",
    data: "2 abr. 2010 — Anacortes, WA (EUA)",
    fonte: "CSB.gov (relatório final)",
    oQueAconteceu:
      "Ruptura catastrófica de um trocador de calor na unidade de hidrotratamento de nafta, no retorno de operação após manutenção. Hidrogênio e nafta a mais de 260°C vazaram e se incendiaram. 7 mortes.",
    aba: "Materiais e Corrosão (Bloco B — Triagem de HTHA, Sprint H6)",
    causa:
      "Ataque por hidrogênio em alta temperatura (HTHA) enfraqueceu o metal do trocador ao longo de anos operando acima da faixa segura para aquele material, sem inspeção que detectasse o dano progressivo. Coberto desde o Sprint H6 — bloco de triagem HTHA (aço carbono + H₂ + T>204°C) que já referencia este caso como exemplo.",
    tier: "Tier 1",
    tierJustificativa: "7 fatalidades — qualquer LOPC com fatalidade é Tier 1.",
  },
  {
    caso: "PEMEX Deer Park",
    data: "10 out. 2024 — Deer Park, TX (EUA)",
    fonte: "CSB.gov (relatório final)",
    oQueAconteceu:
      "Durante manutenção, trabalhadores abriram um flange em tubulação parecida com a que deveria ser aberta (a poucos metros), liberando grande quantidade de gás sulfídrico (H₂S) tóxico. 2 mortes.",
    aba: "Materiais e Corrosão (serviço amargo — H₂S)",
    causa:
      "Identificação inadequada da tubulação (etiquetas ausentes ou fora de vista) combinada com falha na permissão de trabalho, que não isolou corretamente o trecho nem considerou outros trabalhadores a jusante. O risco de H₂S vale mesmo para linhas nominalmente fora de serviço.",
    tier: "Tier 1",
    tierJustificativa: "2 fatalidades por liberação de H₂S — fatalidade classifica automaticamente como Tier 1.",
  },
  {
    caso: "PES Philadelphia",
    data: "21 jun. 2019 — Filadélfia, PA (EUA)",
    fonte: "CSB.gov (relatório final)",
    oQueAconteceu:
      "Um cotovelo de tubulação corroído se rompeu na unidade de alquilação com ácido fluorídrico, liberando líquido inflamável que se incendiou em três explosões — uma lançou um fragmento de vaso de ~17 t a centenas de metros. Sem mortes, 5 feridos.",
    aba: "Materiais e Corrosão / Espessura de Parede B31.3",
    causa:
      "Corrosão acelerada por composição de liga fora da especificação hoje recomendada — o componente, instalado décadas antes, tinha teor de níquel/cobre acima do limite atual para o serviço. Conferir sobrespessura de corrosão e compatibilidade de material para o serviço real, não só a especificação original.",
    tier: "Tier 1",
    tierJustificativa: "Sem fatalidade, mas 3 explosões, 5 feridos e fragmento de vaso de ~17 t arremessado — consequência compatível com Tier 1 mesmo sem óbito.",
  },
  {
    caso: "Esso — Refinaria de Slagentangen",
    data: "24 ago. 2020 — Tønsberg (Noruega)",
    fonte: "Havtil/PSA Norway (relatório final)",
    oQueAconteceu:
      "Vazamento de nafta pesada (~4.400 L) num tubo de 4 polegadas na unidade de destilação atmosférica (pipestill). Sem incêndio nem dano ambiental, mas com risco real de ignição no local. Sem mortes.",
    aba: "Materiais e Corrosão",
    causa:
      "Corrosão sob isolamento (CUI) não detectada a tempo: o trecho havia sido removido do programa de inspeção por engano em 2008, o erro foi percebido em 2013 mas o tubo não voltou à estratégia de manutenção — sem inspeção de CUI desde 2004. Reforça auditar a lista de equipamentos sob programa de inspeção, não só a inspeção em si.",
    tier: "Tier 1 ou 2 (incerto)",
    tierJustificativa: "Sem fatalidade nem incêndio — vazamento contido pelo dreno. A quantidade exata comparada à tabela de limiares por substância (paga) decidiria entre Tier 1 e 2; mantido incerto.",
  },
  {
    caso: "BP Texas City",
    data: "23 mar. 2005 — Texas City, TX (EUA)",
    fonte: "CSB.gov (relatório final)",
    oQueAconteceu:
      "Na partida de uma unidade de isomerização, uma torre de destilação foi enchida além do nível seguro por falha no indicador/alarme de nível. O excesso foi para um vaso de alívio atmosférico (sem flare) que transbordou, formando nuvem de vapor inflamável que se incendiou. 15 mortes, 180 feridos.",
    aba: "Partida e Parada Segura / Torres - Hidráulica",
    causa:
      "Partida realizada com instrumentação de nível conhecidamente defeituosa, sem os alarmes/intertravamentos funcionando, usando um sistema de alívio atmosférico ultrapassado que deveria ter sido substituído por um flare havia anos. Indicador de nível não confiável deve interromper a partida, não seguir com valor estimado.",
    tier: "Tier 1",
    tierJustificativa: "15 fatalidades e 180 feridos — o caso mais grave do bloco, Tier 1 sem ambiguidade.",
  },
  {
    caso: "REPLAN — Refinaria de Paulínia",
    data: "20 ago. 2018 — Paulínia, SP (Brasil)",
    fonte:
      "ANP — Relatório de Investigação de Incidente (RII), com Relatório Detalhado de Incidente da Petrobras em anexo, publicado 18 ago. 2023, gov.br/anp",
    oQueAconteceu:
      "Explosão de tanque de águas ácidas (TQ-68301) durante repartida da unidade de craqueamento catalítico (U-220A) após manutenção — abertura da válvula errada por falha de comunicação via rádio entre painel e campo enviou mistura de GLP/nafta ao tanque de baixa pressão, que rompeu por sobrepressão. Tanque projetado a ~176 m de altura, caiu sobre unidade vizinha 106 m adiante, causando 2ª explosão. 1 ferido leve, sem mortes, ~US$62 milhões em danos.",
    aba: "HAZOP - LOPA / PSSR - Checklist Pre-Partida / Partida e Parada Segura",
    causa:
      "4 causas básicas + 5 contribuintes (árvore de falhas da Petrobras, validada pela ANP). Núcleo do problema: o HAZOP de projeto e as revisões de HAZOP operacionais nunca analisaram a interface entre a unidade de craqueamento e a de tratamento de águas ácidas. Contribuíram também comunicação de campo sem confirmação de tag pelo rádio e malhas de controle mantidas em manual por longo período, impedindo o painel de perceber que a válvula errada havia sido aberta.",
    tier: "Provavelmente Tier 1",
    tierJustificativa: "~240 m³ de hidrocarbonetos liberados (GLP+nafta) é volume grande, mas a confirmação exata dependeria da tabela de limiares por substância do RP 754, não incluída no relatório da ANP. Mais firme que o \"incerto\" anterior, ainda não 100% certo.",
  },
  {
    caso: "Braskem — Polo de Capuava, Santo André",
    data: "22 jun. 2023 — Santo André, SP (Brasil)",
    fonte: "Imprensa/nota sindical — sem relatório técnico público completo",
    oQueAconteceu:
      "Explosão em um tanque de armazenamento de tolueno vazio, em manutenção, durante serviço de pintura (trabalho a quente) por empresa terceirizada. 2 mortes.",
    aba: "Tanques de Armazenamento / Partida e Parada Segura",
    causa:
      "Vapor residual inflamável em tanque 'vazio' mas não purgado/inertizado o suficiente antes de autorizar trabalho a quente — combinação clássica de falha de isolamento com permissão de trabalho inadequada.",
    tier: "Tier 1",
    tierJustificativa: "2 fatalidades num tanque de tolueno durante trabalho a quente — fatalidade classifica automaticamente como Tier 1.",
  },
];

// Sprint G4 — Bloco C: referência dos 4 Tiers do API RP 754 (classificação
// qualitativa pública, sem as tabelas de limiar por substância nem os
// valores em dólar, que são conteúdo pago da norma). Mesmo conteúdo do
// Bloco C da aba "Diagnóstico de Problemas" na planilha.
const TIERS_754 = [
  {
    tier: "Tier 1",
    significa:
      "LOPC de maior consequência: fatalidade, ferimento com afastamento, incêndio/explosão maior, evacuação da comunidade ou liberação acima do maior limiar de quantidade por substância.",
    uso: "Reporte público (indicador divulgado externamente pela empresa/setor).",
  },
  {
    tier: "Tier 2",
    significa:
      "LOPC de menor consequência que ainda atinge o limiar mínimo de reporte — mesma natureza do Tier 1, mas com dano, quantidade liberada ou impacto menores.",
    uso: "Reporte público (mesmo padrão do Tier 1, indicador externo).",
  },
  {
    tier: "Tier 3",
    significa:
      "Desafios a sistemas de segurança: demandas reais sobre camadas de proteção (ex. atuação de PSV, desvio de parâmetro operacional crítico) que não chegaram a virar um LOPC de Tier 1/2.",
    uso: "Indicador interno — acompanhamento pela própria planta/empresa.",
  },
  {
    tier: "Tier 4",
    significa:
      "Indicadores de desempenho do sistema de gestão: execução de inspeções, testes de sistemas de segurança, ações corretivas no prazo — mede a disciplina operacional antes de um evento acontecer.",
    uso: "Indicador interno — uso gerencial/auditoria.",
  },
];

function renderCasosReais() {
  const container = document.getElementById("diag-casos");
  if (!container) return;
  container.innerHTML = "";
  CASOS_REAIS.forEach((c) => {
    const item = document.createElement("div");
    item.className = "case-item";
    item.innerHTML = `
      <div class="case-title">${c.caso}</div>
      <div class="case-meta">${c.data} · Fonte: ${c.fonte}</div>
      <div class="case-body">
        <p>${c.oQueAconteceu}</p>
        <p>${c.causa}</p>
        <p class="case-tier-just">${c.tierJustificativa}</p>
      </div>
      <span class="case-tag">${c.aba}</span>
      <span class="case-tier-tag">${c.tier}</span>
    `;
    container.appendChild(item);
  });
}
renderCasosReais();

function renderTiers754() {
  const container = document.getElementById("diag-tiers754");
  if (!container) return;
  container.innerHTML = "";
  TIERS_754.forEach((t) => {
    const item = document.createElement("div");
    item.className = "tier-item";
    item.innerHTML = `
      <div class="tier-title">${t.tier}</div>
      <p>${t.significa}</p>
      <p class="tier-uso">${t.uso}</p>
    `;
    container.appendChild(item);
  });
}
renderTiers754();

const diagSintoma = document.getElementById("diag-sintoma");
Object.keys(DIAGNOSTICO).forEach((s) => {
  const opt = document.createElement("option");
  opt.value = s;
  opt.textContent = s;
  diagSintoma.appendChild(opt);
});

function updateDiag() {
  const causas = DIAGNOSTICO[diagSintoma.value] || [];
  const container = document.getElementById("diag-causas");
  container.innerHTML = "";
  causas.forEach(([texto, moduloId]) => {
    const row = document.createElement("div");
    row.className = "readout";
    const label = document.createElement("span");
    label.className = "readout-label";
    label.textContent = texto;
    row.appendChild(label);
    if (moduloId) {
      const btn = document.createElement("button");
      btn.className = "btn-add";
      btn.style.width = "auto";
      btn.style.padding = "6px 12px";
      btn.style.marginTop = "0";
      btn.textContent = "Verificar";
      btn.addEventListener("click", () => irParaModulo(moduloId));
      row.appendChild(btn);
    } else {
      const nota = document.createElement("span");
      nota.className = "readout-value mono";
      nota.textContent = "—";
      row.appendChild(nota);
    }
    container.appendChild(row);
  });
}
diagSintoma.addEventListener("change", updateDiag);
updateDiag();

// Partida e Parada Segura — checklist qualitativo por fase, sem cálculo.
// Cada item: [texto, id do módulo relacionado ou null se fora do escopo de cálculo]
const PARTIDA_PARADA = {
  "Preparação": [
    ["Linha de sucção afogada, sem bolsões de ar — conferir NPSH disponível", "npsh"],
    ["Filtro/coador de sucção limpo e ΔP dentro do limite de projeto", "filtro"],
    ["Válvulas de bloqueio e recirculação na posição correta para a partida", null],
    ["PSVs da linha ajustadas, lacradas e sem bloqueio na entrada/saída", "psv"],
    ["Material do sistema compatível com o fluido a ser bombeado", "material"],
    ["Nível mínimo de líquido confirmado no tanque de sucção", null],
  ],
  "Partida": [
    ["Escorva completa antes de acionar — sem rodar a seco", null],
    ["Válvula de descarga aberta lentamente após a escorva, não com o sistema já fechado", "psv"],
    ["Corrente do motor monitorada durante a partida frente à nominal", null],
    ["Ausência de ruído/vibração anormal de cavitação — reconferir NPSH se ocorrer", "npsh"],
    ["Vazão inicial dentro da faixa operacional da curva da bomba", "bomba"],
  ],
  "Operação": [
    ["Tendência de ΔP do filtro acompanhada para prever colmatação", "filtro"],
    ["Temperatura de mancais e selo mecânico dentro da faixa normal", null],
    ["Ponto de operação estável frente à curva do sistema (sem oscilação de vazão)", "bomba"],
    ["Consumo de água de reposição da torre acompanhado, se aplicável", "agua"],
  ],
  "Parada": [
    ["Válvula de descarga fechada gradualmente antes de desligar o motor", null],
    ["Pressão residual da linha aliviada antes de qualquer intervenção", null],
    ["Drenagem/despressurização de vasos e trechos isolados, se aplicável", "vaso"],
    ["Leituras finais registradas para comparação na próxima partida", null],
  ],
  "Emergência": [
    ["Localização e acionamento das válvulas de bloqueio de emergência conhecidos", null],
    ["Caminho de alívio para o flare desobstruído em caso de sobrepressão", "flare"],
    ["Procedimento de parada de emergência do motor/bomba conhecido", null],
    ["Isolamento térmico e sinalização de superfícies quentes verificados em caso de vazamento", "termico"],
  ],
};
const PARTIDA_ESTADO = {};
Object.keys(PARTIDA_PARADA).forEach((fase) => {
  PARTIDA_ESTADO[fase] = PARTIDA_PARADA[fase].map(() => false);
});

const partidaFase = document.getElementById("partida-fase");
Object.keys(PARTIDA_PARADA).forEach((fase) => {
  const opt = document.createElement("option");
  opt.value = fase;
  opt.textContent = fase;
  partidaFase.appendChild(opt);
});

function updatePartida() {
  const fase = partidaFase.value;
  const itens = PARTIDA_PARADA[fase] || [];
  const estado = PARTIDA_ESTADO[fase] || [];
  const container = document.getElementById("partida-itens");
  container.innerHTML = "";
  itens.forEach(([texto, moduloId], i) => {
    const row = document.createElement("div");
    row.className = "readout";
    const label = document.createElement("span");
    label.className = "readout-label";
    label.textContent = texto;
    row.appendChild(label);

    const acoes = document.createElement("span");
    acoes.style.display = "flex";
    acoes.style.gap = "6px";
    acoes.style.alignItems = "center";

    if (moduloId) {
      const btnVer = document.createElement("button");
      btnVer.className = "btn-add";
      btnVer.style.width = "auto";
      btnVer.style.padding = "6px 12px";
      btnVer.style.marginTop = "0";
      btnVer.textContent = "Verificar";
      btnVer.addEventListener("click", () => irParaModulo(moduloId));
      acoes.appendChild(btnVer);
    }

    const btnStatus = document.createElement("button");
    btnStatus.style.width = "auto";
    btnStatus.style.padding = "6px 12px";
    btnStatus.style.marginTop = "0";
    const marcado = estado[i];
    btnStatus.className = marcado ? "btn-add" : "btn-clear";
    btnStatus.textContent = marcado ? "✓ Concluído" : "Pendente";
    btnStatus.addEventListener("click", () => {
      estado[i] = !estado[i];
      updatePartida();
    });
    acoes.appendChild(btnStatus);

    row.appendChild(acoes);
    container.appendChild(row);
  });
  const total = itens.length;
  const feitos = estado.filter(Boolean).length;
  document.getElementById("partida-progresso").textContent = total ? `${feitos} / ${total}` : "—";
}
partidaFase.addEventListener("change", updatePartida);
updatePartida();

// Inspeção Visual — checklist qualitativo por categoria, status OK/NOK por item.
// Cada item: [texto, id do módulo relacionado ou null se fora do escopo de cálculo]
const INSPECAO = {
  "Tubulação": [
    ["Sem corrosão externa, vazamento ou gotejamento visível nas juntas", "material"],
    ["Sem trecho amassado ou com seção visivelmente reduzida", "dw"],
    ["Isolamento térmico íntegro, sem rasgos ou umidade aparente", "termico"],
    ["Flanges e conexões sem sinais de aperto insuficiente", null],
  ],
  "Suportes": [
    ["Suportes fixos e guias sem deformação ou trinca visível", null],
    ["Molas de suporte (se houver) dentro da faixa indicada na placa", null],
    ["Ausência de vibração perceptível ao toque em trechos apoiados", null],
  ],
  "Equipamentos": [
    ["Bomba sem vazamento pelo selo mecânico acima do gotejamento normal", "bomba"],
    ["Nível de óleo do mancal dentro da faixa do visor", null],
    ["Acoplamento com proteção instalada e sem folga aparente", null],
    ["Ruído/vibração anormal na sucção sugerindo cavitação", "npsh"],
  ],
  "Vasos": [
    ["Sem corrosão externa, empolamento de pintura ou abaulamento no costado", "vaso"],
    ["Bocais de instrumentação e dreno sem vazamento", null],
    ["Placa de identificação (TAG, PMTA) legível e presente", "vaso"],
  ],
  "Instrumentos": [
    ["Manômetros e termômetros com ponteiro na faixa normal, vidro íntegro", null],
    ["Visor de nível limpo, com leitura visível", "tanque"],
    ["Placa de orifício sem sinais de obstrução externa aparente", "orif"],
  ],
  "Segurança": [
    ["PSV com lacre íntegro, sem vazamento pelo flange de descarga", "psv"],
    ["Chuveiro/lava-olhos de emergência desobstruído e sinalizado", null],
    ["Extintores no local, dentro da validade, sem obstrução de acesso", null],
    ["Rota de fuga e saída de emergência desobstruídas", null],
  ],
  "Ambiente": [
    ["Sem poças de líquido de processo ou óleo no piso ao redor do equipamento", null],
    ["Bacia de contenção (se houver) livre de água acumulada e detritos", null],
    ["Torre de resfriamento sem arraste visível de gotas além do normal", "agua"],
    ["Ausência de odor anormal de processo na área", null],
  ],
};
// Estado por item: 0 = Pendente, 1 = OK, 2 = NOK — cicla nessa ordem ao clicar.
const INSPECAO_ESTADO = {};
Object.keys(INSPECAO).forEach((cat) => {
  INSPECAO_ESTADO[cat] = INSPECAO[cat].map(() => 0);
});

const inspecaoCategoria = document.getElementById("inspecao-categoria");
Object.keys(INSPECAO).forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat;
  opt.textContent = cat;
  inspecaoCategoria.appendChild(opt);
});

function updateInspecao() {
  const cat = inspecaoCategoria.value;
  const itens = INSPECAO[cat] || [];
  const estado = INSPECAO_ESTADO[cat] || [];
  const container = document.getElementById("inspecao-itens");
  container.innerHTML = "";
  itens.forEach(([texto, moduloId], i) => {
    const row = document.createElement("div");
    row.className = "readout";
    const label = document.createElement("span");
    label.className = "readout-label";
    label.textContent = texto;
    row.appendChild(label);

    const acoes = document.createElement("span");
    acoes.style.display = "flex";
    acoes.style.gap = "6px";
    acoes.style.alignItems = "center";

    if (moduloId) {
      const btnVer = document.createElement("button");
      btnVer.className = "btn-add";
      btnVer.style.width = "auto";
      btnVer.style.padding = "6px 12px";
      btnVer.style.marginTop = "0";
      btnVer.textContent = "Verificar";
      btnVer.addEventListener("click", () => irParaModulo(moduloId));
      acoes.appendChild(btnVer);
    }

    const btnStatus = document.createElement("button");
    btnStatus.style.width = "auto";
    btnStatus.style.padding = "6px 12px";
    btnStatus.style.marginTop = "0";
    const s = estado[i];
    btnStatus.className = s === 1 ? "btn-add" : s === 2 ? "btn-warn" : "btn-clear";
    btnStatus.textContent = s === 1 ? "✓ OK" : s === 2 ? "✕ NOK" : "Pendente";
    btnStatus.addEventListener("click", () => {
      estado[i] = (estado[i] + 1) % 3;
      updateInspecao();
    });
    acoes.appendChild(btnStatus);

    row.appendChild(acoes);
    container.appendChild(row);
  });
  const total = itens.length;
  const ok = estado.filter((s) => s === 1).length;
  const nok = estado.filter((s) => s === 2).length;
  document.getElementById("inspecao-progresso").textContent = total ? `${ok} OK · ${nok} NOK · ${total - ok - nok} pendente` : "—";
}
inspecaoCategoria.addEventListener("change", updateInspecao);
updateInspecao();

// HAZOP / LOPA — Sprint G3. Checklist de desvios de processo por equipamento
// (palavra-guia HAZOP + parâmetro), com causa/consequência típicas e a camada
// de proteção independente (IPL) já coberta pelo app. Mesmo conteúdo da aba
// "HAZOP - LOPA" da planilha — metodologia pública (CCPS), sem norma paga nem
// caso específico de terceiro. Cada desvio: [desvio, causa, consequência, ipl, aba, moduloId]
const HAZOP = {
  "Bombas": [
    ["Vazão zero (No/Not + Vazão)",
     "Válvula de sucção/descarga fechada por engano, escorva perdida, acoplamento partido.",
     "Recirculação interna sem troca de calor, superaquecimento do fluido bombeado, dano ao selo mecânico.",
     "Nenhuma camada modelada no app — depende de alarme de temperatura de carcaça ou válvula de recirculação mínima real.",
     "Bomba — Ponto de Operação", "bomba"],
    ["Vazão baixa / cavitação (Less + Vazão/Pressão de sucção)",
     "NPSH disponível insuficiente, filtro de sucção colmatado, desgaste do rotor.",
     "Erosão do rotor por cavitação, queda de vazão a jusante, ruído/vibração.",
     "Cálculo de NPSH disponível × requerido — camada de verificação em projeto, não de proteção automática em operação.",
     "NPSH + Afinidade", "npsh"],
    ["Fluxo reverso (Reverse + Vazão)",
     "Falha de válvula de retenção com a bomba parada.",
     "Rotação reversa da bomba, dano mecânico ao acoplamento/motor.",
     "Válvula de retenção — física, fora do escopo de cálculo deste app.",
     "— (checklist qualitativo, sem cálculo dedicado)", null],
  ],
  "Vasos de Pressão": [
    ["Pressão alta (More + Pressão)",
     "Bloqueio de saída, reação exotérmica descontrolada, fogo externo.",
     "Ruptura catastrófica do vaso.",
     "Coberto — PSV dimensionada para o cenário de contingência (camada ativa mecânica).",
     "PSV — Válvula de Alívio", "psv"],
    ["Nível alto (More + Nível)",
     "Falha do instrumento ou da malha de controle de nível.",
     "Carryover de líquido para a linha de vapor a jusante.",
     "Nenhuma camada modelada — depende de LSH/intertravamento real da planta.",
     "— (checklist qualitativo, sem cálculo dedicado)", null],
    ["Temperatura alta (More + Temperatura)",
     "Falha de resfriamento, reação exotérmica.",
     "Aumento da pressão de vapor do fluido interno, risco de ruptura.",
     "Verificar limite de temperatura de projeto do vaso (camada de verificação em projeto).",
     "Vasos de Pressão", "vaso"],
  ],
  "Trocadores de Calor": [
    ["Perda de vazão do lado frio (No/Not + Vazão)",
     "Bomba desligada, válvula fechada no lado frio.",
     "Superaquecimento do fluido quente, possível vaporização e sobrepressão no lado quente.",
     "Nenhuma camada modelada — depende de intertravamento de vazão mínima real.",
     "Trocadores de Calor", "troca"],
    ["Ruptura de tubo interno (Other Than)",
     "Corrosão, erosão, fadiga térmica.",
     "Contaminação cruzada entre os dois fluidos, sobrepressão do lado de menor pressão de projeto.",
     "Inspeção periódica — camada de detecção, não de prevenção automática.",
     "Materiais / Corrosão", "material"],
  ],
  "Torres / Colunas": [
    ["Nível de fundo alto (More + Nível)",
     "Falha de controle de nível do refervedor.",
     "Carryover de líquido para o topo, contaminação do produto de topo.",
     "Nenhuma camada modelada.",
     "— (checklist qualitativo, sem cálculo dedicado)", null],
    ["Inundação / flooding (More + Vazão de vapor)",
     "Vazão de vapor acima da capacidade hidráulica dos pratos/recheio.",
     "Perda de eficiência de separação, arraste excessivo de líquido.",
     "Verificar % de inundação calculado no módulo (camada de verificação em projeto).",
     "Colunas / Torres", "coluna"],
    ["Pressão de topo alta (More + Pressão)",
     "Condensador subdimensionado, falha do sistema de vácuo.",
     "Sobrepressão da coluna.",
     "Coberto — PSV de topo dimensionada.",
     "PSV — Válvula de Alívio", "psv"],
  ],
  "Compressores": [
    ["Surge / vazão baixa (Less + Vazão)",
     "Demanda a jusante reduzida sem reciclo, falha da válvula anti-surge.",
     "Dano severo ao rotor por ciclos de surge repetidos.",
     "Válvula anti-surge — física, fora do escopo de cálculo deste app.",
     "— (checklist qualitativo, sem cálculo dedicado)", null],
    ["Temperatura de descarga alta (More + Temperatura)",
     "Razão de compressão acima do projeto, eficiência politrópica degradada.",
     "Degradação do óleo lubrificante, risco em serviços com O₂/gases reativos.",
     "Verificar limite de temperatura de descarga calculado (camada de verificação em projeto).",
     "Compressores", "comprr"],
  ],
  "Tanques de Armazenamento": [
    ["Nível alto / transbordamento (More + Nível)",
     "Falha de LT/LSH, erro operacional na transferência.",
     "Derramamento, risco ambiental e de incêndio.",
     "Nenhuma camada modelada — depende de LSH/intertravamento real.",
     "Tanques", "tanque"],
    ["Vácuo / colapso do teto (Less + Pressão interna)",
     "Bombeamento de saída sem entrada de ar suficiente (ventosa subdimensionada).",
     "Colapso estrutural do teto do tanque.",
     "Coberto — dimensionamento de ventosa para vazão de esvaziamento.",
     "Ventosas e VAP", "ventosas"],
    ["Sobrepressão por respiração térmica (More + Pressão interna)",
     "Aquecimento solar/vapor sem alívio suficiente.",
     "Deformação ou ruptura do teto.",
     "Coberto — dimensionamento de ventosa para respiração térmica.",
     "Ventosas e VAP", "ventosas"],
  ],
  "Fornos e Caldeiras": [
    ["Chama apagada com combustível ainda fluindo (No/Not + Ignição)",
     "Falha do piloto ou do sistema de gerenciamento de queima (BMS).",
     "Acúmulo de combustível não queimado, risco de explosão na reignição.",
     "Sistema de gerenciamento de queima (BMS) — instrumentado, fora do escopo de cálculo deste app.",
     "— (checklist qualitativo, sem cálculo dedicado)", null],
    ["Temperatura de pele do tubo alta (More + Temperatura)",
     "Coqueamento interno, vazão insuficiente no tubo.",
     "Ruptura do tubo por fluência térmica.",
     "Verificar fluxo de calor e temperatura de pele calculados (camada de verificação em projeto).",
     "Fornos / Caldeiras", "forno"],
  ],
  "Tubulação / Linhas em Geral": [
    ["Perda de contenção (Other Than)",
     "Corrosão interna/externa, erosão, fadiga mecânica.",
     "Vazamento de fluido de processo, risco de incêndio/toxicidade.",
     "Inspeção periódica + sobrespessura de corrosão de projeto.",
     "Materiais / Corrosão + Espessura de Parede", "material"],
    ["Sobrepressão transiente / golpe de aríete (Early/Late + fechamento de válvula)",
     "Fechamento rápido de válvula, parada abrupta de bomba.",
     "Ruptura da linha por sobrepressão transiente.",
     "Verificar tempo de fechamento seguro calculado (camada de verificação em projeto).",
     "Transientes — Golpe de Aríete", "transientes"],
  ],
};

// (camada, o_que_e, cobertura_hoje)
const HAZOP_LOPA = [
  ["Sistema Básico de Controle de Processo (BPCS)",
   "Malha de controle automática normal (ex.: controlador de nível, pressão, vazão). Na metodologia LOPA clássica, só conta como IPL se for genuinamente independente da causa do desvio analisado.",
   "Fora do escopo de cálculo — o app dimensiona equipamentos, não modela malhas de controle."],
  ["Alarme + resposta humana",
   "Alarme de processo (alto/baixo) com tempo suficiente para o operador agir antes da consequência.",
   "Fora do escopo de cálculo — depende de instrumentação/SCADA real da planta."],
  ["Sistema Instrumentado de Segurança (SIS/SIF)",
   "Intertravamento automático dedicado, independente do BPCS, com sensor, lógica e elemento final próprios (ex.: shutdown por alta pressão).",
   "Fora do escopo de cálculo — este app não modela lógica de intertravamento."],
  ["Válvula de alívio (PSV)",
   "Dispositivo mecânico de alívio de sobrepressão — camada passiva, atua sem eletricidade nem instrumentação.",
   "Coberto — módulo PSV — Válvula de Alívio dimensiona por cenário de contingência (API 520/521)."],
  ["Contenção física passiva",
   "Dique/bacia de contenção, parede corta-fogo, distanciamento entre equipamentos.",
   "Parcialmente coberto — módulo Tanques faz referência qualitativa, sem cálculo de volume de bacia."],
  ["Mitigação pós-evento",
   "Combate a incêndio, plano de resposta a emergência, evacuação.",
   "Fora do escopo de cálculo — ver módulo Partida/Parada para checklist operacional relacionado."],
];

const hazopCategoria = document.getElementById("hazop-categoria");
Object.keys(HAZOP).forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat;
  opt.textContent = cat;
  hazopCategoria.appendChild(opt);
});

function updateHazop() {
  const cat = hazopCategoria.value;
  const desvios = HAZOP[cat] || [];
  const container = document.getElementById("hazop-desvios");
  container.innerHTML = "";
  desvios.forEach(([desvio, causa, consequencia, ipl, aba, moduloId]) => {
    const item = document.createElement("div");
    item.className = "case-item";
    item.innerHTML = `
      <div class="case-title">${desvio}</div>
      <div class="case-meta">Causa típica: ${causa}</div>
      <div class="case-body">
        <p><strong>Consequência típica:</strong> ${consequencia}</p>
        <p><strong>IPL hoje:</strong> ${ipl}</p>
      </div>
      <span class="case-tag">${aba}</span>
    `;
    if (moduloId) {
      const btn = document.createElement("button");
      btn.className = "btn-add";
      btn.style.width = "auto";
      btn.style.padding = "6px 12px";
      btn.style.marginTop = "8px";
      btn.textContent = "Verificar";
      btn.addEventListener("click", () => irParaModulo(moduloId));
      item.appendChild(btn);
    }
    container.appendChild(item);
  });
}
hazopCategoria.addEventListener("change", updateHazop);
updateHazop();

function renderHazopLopa() {
  const container = document.getElementById("hazop-lopa");
  if (!container) return;
  container.innerHTML = "";
  HAZOP_LOPA.forEach(([camada, oQueE, cobertura]) => {
    const item = document.createElement("div");
    item.className = "case-item";
    item.innerHTML = `
      <div class="case-title">${camada}</div>
      <div class="case-body">
        <p>${oQueE}</p>
        <p>${cobertura}</p>
      </div>
    `;
    container.appendChild(item);
  });
}
renderHazopLopa();

// ---------------- RBI Simplificado (Sprint H1) ----------------
// Matriz de risco qualitativa (API RP 580), mesmo conteúdo/critérios da aba
// "RBI Simplificado" da planilha — usuário cadastra quantos TAGs quiser,
// Risco/Classe/Frequência calculados ao vivo (mesma fórmula da planilha).
const RBI_POF = [
  [1, "Muito baixa", "Serviço brando, material adequado, sem mecanismo de dano conhecido ativo."],
  [2, "Baixa", "Serviço moderado, mecanismo de dano conhecido mas de progressão lenta (corrosão generalizada leve)."],
  [3, "Média", "Serviço severo (alta P/T, cíclico) ou mecanismo de dano localizado (corrosão sob isolamento, fadiga térmica)."],
  [4, "Alta", "Mecanismo de dano agressivo e dependente de temperatura/tempo (ex. HTHA, fluência), operação continuada acima da faixa segura do material."],
  [5, "Muito alta", "Histórico de falha conhecido no setor para o mesmo serviço/material sem mitigação adicional."],
];
const RBI_COF = [
  [1, "Muito baixa", "Sem inventário inflamável relevante, sem risco a pessoas."],
  [2, "Baixa", "Inventário pequeno, baixa pressão, risco de contenção local."],
  [3, "Média", "Inventário moderado sob pressão, possibilidade de incêndio localizado."],
  [4, "Alta", "Grande inventário pressurizado/inflamável, potencial de incêndio/explosão relevante."],
  [5, "Muito alta", "Grande inventário criogênico ou a alta temperatura/pressão, potencial catastrófico (múltiplas fatalidades, dano à comunidade)."],
];
// (min, max, classe, frequência sugerida) — mesmas faixas da planilha
const RBI_CLASSES = [
  [1, 4, "Baixo", "5-6 anos — monitoramento contínuo (vibração/temperatura) substitui inspeção intrusiva frequente"],
  [5, 9, "Médio", "3-5 anos — inspeção externa/interna na parada geral programada"],
  [10, 15, "Alto", "1-2 anos — inspeção intrusiva (espessura por ultrassom, CUI) fora da parada geral"],
  [16, 25, "Crítico", "Anual — inspeção de espessura/metalografia de campo + monitoramento contínuo"],
];

function rbiClasse(risco) {
  for (const [lo, hi, nome] of RBI_CLASSES) {
    if (risco >= lo && risco <= hi) return nome;
  }
  return "Crítico";
}
function rbiFrequencia(classe) {
  const item = RBI_CLASSES.find(([, , nome]) => nome === classe);
  return item ? item[3] : "";
}
function rbiCorClasse(classe) {
  return { "Baixo": "#198754", "Médio": "#FFC107", "Alto": "#FD7E14", "Crítico": "#DC3545" }[classe] || "#999";
}

function renderRbiCriterios() {
  const container = document.getElementById("rbi-criterios");
  container.innerHTML = "";
  RBI_POF.forEach(([n, nivel, criterio], idx) => {
    const [, nivelC, criterioC] = RBI_COF[idx];
    const item = document.createElement("div");
    item.className = "case-item";
    item.innerHTML = `
      <div class="case-title">Nível ${n} — PoF: ${nivel}</div>
      <div class="case-body"><p>${criterio}</p></div>
      <div class="case-title" style="margin-top:8px">Nível ${n} — CoF: ${nivelC}</div>
      <div class="case-body"><p>${criterioC}</p></div>
    `;
    container.appendChild(item);
  });
}
renderRbiCriterios();

function renderRbiMatriz() {
  const table = document.getElementById("rbi-matriz");
  let html = "<thead><tr><th>PoF ↓ / CoF →</th>" + [1, 2, 3, 4, 5].map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
  for (let pof = 1; pof <= 5; pof++) {
    html += `<tr><th>${pof}</th>`;
    for (let cof = 1; cof <= 5; cof++) {
      const risco = pof * cof;
      const classe = rbiClasse(risco);
      html += `<td style="background:${rbiCorClasse(classe)};color:#fff;text-align:center;font-weight:600">${risco}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  table.innerHTML = html;
}
renderRbiMatriz();

const rbiPof = document.getElementById("rbi-pof");
const rbiCof = document.getElementById("rbi-cof");
[1, 2, 3, 4, 5].forEach((n) => {
  [rbiPof, rbiCof].forEach((sel) => {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = String(n);
    sel.appendChild(opt);
  });
});

let rbiEquipamentos = [];

function renderRbi() {
  const tbody = document.getElementById("rbi-tbody");
  const empty = document.getElementById("rbi-empty");
  tbody.innerHTML = "";
  empty.hidden = rbiEquipamentos.length > 0;

  rbiEquipamentos.forEach((eq, idx) => {
    const risco = eq.pof * eq.cof;
    const classe = rbiClasse(risco);
    const freq = rbiFrequencia(classe);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family:var(--font-body)">${eq.tag}</td>
      <td style="font-family:var(--font-body)">${eq.equipamento}</td>
      <td style="font-family:var(--font-body)">${eq.mecanismo}</td>
      <td>${eq.pof}</td>
      <td>${eq.cof}</td>
      <td>${risco}</td>
      <td><span style="background:${rbiCorClasse(classe)};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.85em">${classe}</span></td>
      <td style="font-family:var(--font-body);font-size:0.85em">${freq}</td>
      <td><button class="row-remove" data-idx="${idx}">remover</button></td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll("#rbi-tbody .row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      rbiEquipamentos.splice(parseInt(btn.dataset.idx, 10), 1);
      renderRbi();
    });
  });
}
document.getElementById("rbi-add").addEventListener("click", () => {
  const tag = document.getElementById("rbi-tag").value.trim();
  const equipamento = document.getElementById("rbi-equipamento").value.trim();
  const mecanismo = document.getElementById("rbi-mecanismo").value.trim();
  if (!tag) return;
  rbiEquipamentos.push({
    tag,
    equipamento: equipamento || "—",
    mecanismo: mecanismo || "—",
    pof: parseInt(rbiPof.value, 10) || 1,
    cof: parseInt(rbiCof.value, 10) || 1,
  });
  document.getElementById("rbi-tag").value = "";
  document.getElementById("rbi-equipamento").value = "";
  document.getElementById("rbi-mecanismo").value = "";
  renderRbi();
});
document.getElementById("rbi-clear").addEventListener("click", () => {
  rbiEquipamentos = [];
  renderRbi();
});
renderRbi();

// ---------------- Emissões Fugitivas / LDAR (Sprint H2) ----------------
// Mesmos fatores e fórmulas da aba "Emissões Fugitivas - LDAR" da planilha —
// EPA AP-42, Capítulo 5, Método 21 (fatores médios por tipo de fonte).
const LDAR_FONTES = [
  { fonte: "Válvulas (gás/hidrocarboneto leve)", fator: 0.004 },
  { fonte: "Válvulas (líquido leve)", fator: 0.002 },
  { fonte: "Bombas (selo simples)", fator: 0.020 },
  { fonte: "Bombas (selo duplo)", fator: 0.005 },
  { fonte: "Compressores (selo de gás)", fator: 0.050 },
  { fonte: "Flanges", fator: 0.001 },
  { fonte: "Respiros / Vent", fator: 0.010 },
];
let ldarQuantidades = LDAR_FONTES.map(() => 0);
let ldarFatores = LDAR_FONTES.map((f) => f.fator);

function renderLdar() {
  const tbody = document.getElementById("ldar-tbody");
  const horas = parseFloat(document.getElementById("ldar-horas").value) || 8000;
  tbody.innerHTML = "";
  let totalKgh = 0;
  LDAR_FONTES.forEach((f, idx) => {
    const qtd = ldarQuantidades[idx];
    const fator = ldarFatores[idx];
    const emissaoKgh = qtd * fator;
    totalKgh += emissaoKgh;
    const emissaoTano = emissaoKgh * horas / 1000;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family:var(--font-body)">${f.fonte}</td>
      <td><input type="number" class="ldar-qtd" data-idx="${idx}" value="${qtd}" min="0" step="1" inputmode="numeric" style="width:70px"></td>
      <td><input type="number" class="ldar-fator" data-idx="${idx}" value="${fator}" min="0" step="0.001" inputmode="decimal" style="width:80px"></td>
      <td>${emissaoKgh.toFixed(2)}</td>
      <td>${emissaoTano.toFixed(1)}</td>`;
    tbody.appendChild(tr);
  });
  const totalTano = totalKgh * horas / 1000;
  document.getElementById("ldar-total-kgh").textContent = `${totalKgh.toFixed(2)} kg/h`;
  document.getElementById("ldar-total-tano").textContent = `${totalTano.toFixed(1)} t/ano`;

  document.querySelectorAll(".ldar-qtd").forEach((el) => {
    el.addEventListener("input", () => {
      ldarQuantidades[parseInt(el.dataset.idx, 10)] = parseFloat(el.value) || 0;
      renderLdar();
    });
  });
  document.querySelectorAll(".ldar-fator").forEach((el) => {
    el.addEventListener("input", () => {
      ldarFatores[parseInt(el.dataset.idx, 10)] = parseFloat(el.value) || 0;
      renderLdar();
    });
  });
}
document.getElementById("ldar-horas").addEventListener("input", renderLdar);
renderLdar();

// ---------------- Emissões de Combustão (Sprint H9) ----------------
// Mesma família normativa do LDAR (EPA AP-42), capítulo diferente (Cap. 1,
// External Combustion Sources) — emissão de chaminé por queima de
// combustível, não vazamento fugitivo de componente. CO2 de estequiometria/
// IPCC 2006; NOx e CO típicos não controlados do AP-42 1.3/1.4; SO2 é o
// mais incerto (depende do teor de enxofre real do lote de combustível).
const EMISSOES_COMBUSTIVEIS = [
  { nome: "Gás natural", pci: 35.8, co2: 56.1, nox: 0.05, co: 0.035, so2: 0.0003 },
  { nome: "GLP", pci: 46.1, co2: 63.1, nox: 0.06, co: 0.03, so2: 0.0004 },
  { nome: "Óleo combustível (BPF)", pci: 40.0, co2: 77.4, nox: 0.17, co: 0.02, so2: 1.5 },
  { nome: "Diesel", pci: 43.0, co2: 74.1, nox: 0.15, co: 0.02, so2: 0.5 },
];
let emissoesConsumo = EMISSOES_COMBUSTIVEIS.map(() => 0);
let emissoesFatores = EMISSOES_COMBUSTIVEIS.map((f) => ({ pci: f.pci, co2: f.co2, nox: f.nox, co: f.co, so2: f.so2 }));

function renderEmissoes() {
  const tbody = document.getElementById("emissoes-tbody");
  const horas = parseFloat(document.getElementById("emissoes-horas").value) || 8000;
  tbody.innerHTML = "";
  let totalCo2 = 0, totalNox = 0, totalCo = 0, totalSo2 = 0;
  EMISSOES_COMBUSTIVEIS.forEach((f, idx) => {
    const consumo = emissoesConsumo[idx];
    const fat = emissoesFatores[idx];
    const energiaGJh = (consumo * fat.pci) / 1000;
    const co2Kgh = energiaGJh * fat.co2;
    const noxKgh = energiaGJh * fat.nox;
    const coKgh = energiaGJh * fat.co;
    const so2Kgh = energiaGJh * fat.so2;
    totalCo2 += co2Kgh; totalNox += noxKgh; totalCo += coKgh; totalSo2 += so2Kgh;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family:var(--font-body)">${f.nome}</td>
      <td><input type="number" class="emissoes-consumo" data-idx="${idx}" value="${consumo}" min="0" step="1" inputmode="decimal" style="width:70px"></td>
      <td><input type="number" class="emissoes-pci" data-idx="${idx}" value="${fat.pci}" min="0" step="0.1" inputmode="decimal" style="width:64px"></td>
      <td><input type="number" class="emissoes-co2" data-idx="${idx}" value="${fat.co2}" min="0" step="0.1" inputmode="decimal" style="width:64px"></td>
      <td><input type="number" class="emissoes-nox" data-idx="${idx}" value="${fat.nox}" min="0" step="0.001" inputmode="decimal" style="width:64px"></td>
      <td><input type="number" class="emissoes-co" data-idx="${idx}" value="${fat.co}" min="0" step="0.001" inputmode="decimal" style="width:64px"></td>
      <td><input type="number" class="emissoes-so2" data-idx="${idx}" value="${fat.so2}" min="0" step="0.0001" inputmode="decimal" style="width:70px"></td>
      <td>${co2Kgh.toFixed(2)}</td>
      <td>${noxKgh.toFixed(3)}</td>
      <td>${coKgh.toFixed(3)}</td>
      <td>${so2Kgh.toFixed(4)}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("emissoes-total-co2").textContent = `${totalCo2.toFixed(1)} kg/h`;
  document.getElementById("emissoes-total-nox").textContent = `${totalNox.toFixed(2)} kg/h`;
  document.getElementById("emissoes-total-co").textContent = `${totalCo.toFixed(2)} kg/h`;
  document.getElementById("emissoes-total-so2").textContent = `${totalSo2.toFixed(3)} kg/h`;
  document.getElementById("emissoes-total-co2-tano").textContent = `${((totalCo2 * horas) / 1000).toFixed(1)} t/ano`;

  document.querySelectorAll(".emissoes-consumo").forEach((el) => {
    el.addEventListener("input", () => {
      emissoesConsumo[parseInt(el.dataset.idx, 10)] = parseFloat(el.value) || 0;
      renderEmissoes();
    });
  });
  const fatorMap = { pci: "emissoes-pci", co2: "emissoes-co2", nox: "emissoes-nox", co: "emissoes-co", so2: "emissoes-so2" };
  Object.entries(fatorMap).forEach(([key, cls]) => {
    document.querySelectorAll(`.${cls}`).forEach((el) => {
      el.addEventListener("input", () => {
        emissoesFatores[parseInt(el.dataset.idx, 10)][key] = parseFloat(el.value) || 0;
        renderEmissoes();
      });
    });
  });
}
document.getElementById("emissoes-horas").addEventListener("input", renderEmissoes);
renderEmissoes();

// ---------------- PSSR — Checklist Pré-Partida (Sprint H3) ----------------
// Mesma categorização/itens da aba "PSSR - Checklist Pre-Partida" da
// planilha — usuário pode adicionar itens próprios da unidade dele.
const PSSR_ITENS_INICIAIS = [
  ["Integridade Mecânica", "Teste hidrostático de vasos e tubulações (ASME VIII / B31.3) concluído e registrado"],
  ["Integridade Mecânica", "Verificação de espessura de cascos/tubos (espessura medida ≥ nominal de projeto)"],
  ["Integridade Mecânica", "Certificação de materiais críticos (corpo de prova, rastreabilidade) conferida"],
  ["Integridade Mecânica", "Alinhamento de bombas e compressores — folgas e vibração dentro do critério"],
  ["Integridade Mecânica", "Teste de estanqueidade de linhas críticas (flare, KOD, interligações novas)"],
  ["Instrumentação e SIS", "Teste funcional de todas as malhas de controle (BPCS) da área nova/modificada"],
  ["Instrumentação e SIS", "Simulação de cenários de emergência do SIS (corte de combustível, abertura de alívio)"],
  ["Instrumentação e SIS", "Calibração de transmissores de pressão, nível e temperatura (PT/LT/TT) concluída"],
  ["Instrumentação e SIS", "Verificação de analisadores de gases/detectores (O2, H2S, LEL) operacionais"],
  ["Instrumentação e SIS", "Teste de atuação das PSVs — set pressures conferidos contra o projeto"],
  ["Segurança Operacional", "Procedimentos de partida, operação normal e parada de emergência (SOPs) emitidos"],
  ["Segurança Operacional", "Treinamento da equipe operacional na área nova/modificada concluído"],
  ["Segurança Operacional", "Sinalização de segurança e classificação de áreas (Zona 0/1/2) conferida em campo"],
  ["Segurança Operacional", "EPIs específicos disponíveis e adequados ao serviço"],
  ["Segurança Operacional", "Plano de atendimento de emergência (PAME) atualizado com a área nova/modificada"],
];
const PSSR_STATUS_OPCOES = ["Pendente", "OK", "N/A", "Reprovado"];
let pssrItens = PSSR_ITENS_INICIAIS.map(([categoria, item]) => ({
  categoria, item, status: "Pendente", verificadoPor: "", observacao: "",
}));

function pssrCorStatus(status) {
  return { OK: "#198754", Pendente: "#FFC107", "N/A": "#6c757d", Reprovado: "#DC3545" }[status] || "#999";
}

function renderPssr() {
  const tbody = document.getElementById("pssr-tbody");
  tbody.innerHTML = "";
  pssrItens.forEach((it, idx) => {
    const tr = document.createElement("tr");
    const statusOpts = PSSR_STATUS_OPCOES.map(
      (s) => `<option value="${s}" ${s === it.status ? "selected" : ""}>${s}</option>`
    ).join("");
    tr.innerHTML = `
      <td style="font-family:var(--font-body);font-weight:600">${it.categoria}</td>
      <td style="font-family:var(--font-body)">${it.item}</td>
      <td><select class="pssr-status" data-idx="${idx}" style="background:${pssrCorStatus(it.status)};color:#fff;border-radius:6px;padding:4px">${statusOpts}</select></td>
      <td><input type="text" class="pssr-verificado" data-idx="${idx}" value="${it.verificadoPor}" placeholder="nome" style="width:100px"></td>
      <td><input type="text" class="pssr-obs" data-idx="${idx}" value="${it.observacao}" placeholder="observação" style="width:140px"></td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll(".pssr-status").forEach((el) => {
    el.addEventListener("change", () => {
      pssrItens[parseInt(el.dataset.idx, 10)].status = el.value;
      renderPssr();
    });
  });
  document.querySelectorAll(".pssr-verificado").forEach((el) => {
    el.addEventListener("input", () => {
      pssrItens[parseInt(el.dataset.idx, 10)].verificadoPor = el.value;
    });
  });
  document.querySelectorAll(".pssr-obs").forEach((el) => {
    el.addEventListener("input", () => {
      pssrItens[parseInt(el.dataset.idx, 10)].observacao = el.value;
    });
  });

  const nOk = pssrItens.filter((i) => i.status === "OK").length;
  const nPendente = pssrItens.filter((i) => i.status === "Pendente").length;
  const nReprovado = pssrItens.filter((i) => i.status === "Reprovado").length;
  document.getElementById("pssr-count-ok").textContent = String(nOk);
  document.getElementById("pssr-count-pendente").textContent = String(nPendente);
  document.getElementById("pssr-count-reprovado").textContent = String(nReprovado);
  const liberadoEl = document.getElementById("pssr-liberado");
  if (nReprovado > 0) {
    liberadoEl.textContent = "NÃO — há item reprovado";
    liberadoEl.style.color = "#DC3545";
  } else if (nPendente > 0) {
    liberadoEl.textContent = "NÃO — há item pendente";
    liberadoEl.style.color = "#FFC107";
  } else {
    liberadoEl.textContent = "SIM";
    liberadoEl.style.color = "#198754";
  }
}
document.getElementById("pssr-add").addEventListener("click", () => {
  const categoria = document.getElementById("pssr-categoria").value.trim();
  const item = document.getElementById("pssr-item").value.trim();
  if (!item) return;
  pssrItens.push({ categoria: categoria || "Outros", item, status: "Pendente", verificadoPor: "", observacao: "" });
  document.getElementById("pssr-categoria").value = "";
  document.getElementById("pssr-item").value = "";
  renderPssr();
});
renderPssr();

// ---------------- Balanço de Utilidades (Sprint H4) ----------------
// Cadastro por planta de consumidores de vapor, água de resfriamento,
// nitrogênio inerte e elétrico — mesma lógica da aba "Balanço de
// Utilidades" da planilha. Água de resfriamento: Q(MW) = m(kg/s)*cp*ΔT,
// cp=4,186 kJ/(kg·K) (mesmo valor do módulo "Água de Resfriamento").
let utilVapor = [];
let utilAgua = [];
let utilN2 = [];
let utilEletrico = [];

function renderUtilVapor() {
  const tbody = document.getElementById("util-vapor-tbody");
  tbody.innerHTML = "";
  let total = 0;
  utilVapor.forEach((it, idx) => {
    total += it.vazao;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${it.nome}</td><td>${it.vazao.toFixed(2)}</td><td>${it.pressao.toFixed(1)}</td>
      <td><button class="row-remove" data-idx="${idx}">remover</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("util-vapor-empty").hidden = utilVapor.length > 0;
  document.getElementById("util-vapor-total").textContent = `${total.toFixed(2)} t/h`;
  tbody.querySelectorAll(".row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      utilVapor.splice(parseInt(btn.dataset.idx, 10), 1);
      renderUtilVapor();
    });
  });
}
document.getElementById("util-vapor-add").addEventListener("click", () => {
  const nome = document.getElementById("util-vapor-nome").value.trim();
  if (!nome) return;
  utilVapor.push({
    nome,
    vazao: parseFloat(document.getElementById("util-vapor-vazao").value) || 0,
    pressao: parseFloat(document.getElementById("util-vapor-pressao").value) || 0,
  });
  document.getElementById("util-vapor-nome").value = "";
  document.getElementById("util-vapor-vazao").value = "";
  document.getElementById("util-vapor-pressao").value = "";
  renderUtilVapor();
});
renderUtilVapor();

function renderUtilAgua() {
  const tbody = document.getElementById("util-agua-tbody");
  tbody.innerHTML = "";
  let totalVazao = 0;
  let totalMw = 0;
  utilAgua.forEach((it, idx) => {
    const qMw = (it.vazao * 1000 / 3600) * 4.186 * it.deltaT / 1000;
    totalVazao += it.vazao;
    totalMw += qMw;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${it.nome}</td><td>${it.vazao.toFixed(2)}</td><td>${it.deltaT.toFixed(1)}</td><td>${qMw.toFixed(2)}</td>
      <td><button class="row-remove" data-idx="${idx}">remover</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("util-agua-empty").hidden = utilAgua.length > 0;
  document.getElementById("util-agua-total-vazao").textContent = `${totalVazao.toFixed(2)} t/h`;
  document.getElementById("util-agua-total-mw").textContent = `${totalMw.toFixed(2)} MW`;
  tbody.querySelectorAll(".row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      utilAgua.splice(parseInt(btn.dataset.idx, 10), 1);
      renderUtilAgua();
    });
  });
}
document.getElementById("util-agua-add").addEventListener("click", () => {
  const nome = document.getElementById("util-agua-nome").value.trim();
  if (!nome) return;
  utilAgua.push({
    nome,
    vazao: parseFloat(document.getElementById("util-agua-vazao").value) || 0,
    deltaT: parseFloat(document.getElementById("util-agua-deltat").value) || 0,
  });
  document.getElementById("util-agua-nome").value = "";
  document.getElementById("util-agua-vazao").value = "";
  document.getElementById("util-agua-deltat").value = "";
  renderUtilAgua();
});
renderUtilAgua();

function renderUtilN2() {
  const tbody = document.getElementById("util-n2-tbody");
  tbody.innerHTML = "";
  let totalNormal = 0;
  let totalPico = 0;
  utilN2.forEach((it, idx) => {
    totalNormal += it.normal;
    totalPico += it.pico;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${it.nome}</td><td>${it.normal.toFixed(0)}</td><td>${it.pico.toFixed(0)}</td>
      <td><button class="row-remove" data-idx="${idx}">remover</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("util-n2-empty").hidden = utilN2.length > 0;
  document.getElementById("util-n2-total-normal").textContent = `${totalNormal.toFixed(0)} Nm³/h`;
  document.getElementById("util-n2-total-pico").textContent = `${totalPico.toFixed(0)} Nm³/h`;
  tbody.querySelectorAll(".row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      utilN2.splice(parseInt(btn.dataset.idx, 10), 1);
      renderUtilN2();
    });
  });
}
document.getElementById("util-n2-add").addEventListener("click", () => {
  const nome = document.getElementById("util-n2-nome").value.trim();
  if (!nome) return;
  utilN2.push({
    nome,
    normal: parseFloat(document.getElementById("util-n2-normal").value) || 0,
    pico: parseFloat(document.getElementById("util-n2-pico").value) || 0,
  });
  document.getElementById("util-n2-nome").value = "";
  document.getElementById("util-n2-normal").value = "";
  document.getElementById("util-n2-pico").value = "";
  renderUtilN2();
});
renderUtilN2();

function renderUtilEletrico() {
  const tbody = document.getElementById("util-elet-tbody");
  tbody.innerHTML = "";
  let total = 0;
  utilEletrico.forEach((it, idx) => {
    total += it.potencia;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${it.nome}</td><td>${it.potencia.toFixed(0)}</td>
      <td><button class="row-remove" data-idx="${idx}">remover</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById("util-elet-empty").hidden = utilEletrico.length > 0;
  const fator = parseFloat(document.getElementById("util-elet-fator").value) || 0;
  document.getElementById("util-elet-total-instalado").textContent = `${total.toFixed(0)} kW`;
  document.getElementById("util-elet-total-medio").textContent = `${(total * fator).toFixed(0)} kW`;
  tbody.querySelectorAll(".row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      utilEletrico.splice(parseInt(btn.dataset.idx, 10), 1);
      renderUtilEletrico();
    });
  });
}
document.getElementById("util-elet-add").addEventListener("click", () => {
  const nome = document.getElementById("util-elet-nome").value.trim();
  if (!nome) return;
  utilEletrico.push({
    nome,
    potencia: parseFloat(document.getElementById("util-elet-potencia").value) || 0,
  });
  document.getElementById("util-elet-nome").value = "";
  document.getElementById("util-elet-potencia").value = "";
  renderUtilEletrico();
});
document.getElementById("util-elet-fator").addEventListener("input", renderUtilEletrico);
renderUtilEletrico();

document.getElementById("util-clear").addEventListener("click", () => {
  utilVapor = [];
  utilAgua = [];
  utilN2 = [];
  utilEletrico = [];
  renderUtilVapor();
  renderUtilAgua();
  renderUtilN2();
  renderUtilEletrico();
});

// Tanque de Pulmão (Surge Tank) — volume mínimo por desbalanço de vazão + margem de variação.
function updatePulmao() {
  const qin = parseFloat(document.getElementById("pulmao-qin").value) || 0;
  const qout = parseFloat(document.getElementById("pulmao-qout").value) || 0;
  const varPct = parseFloat(document.getElementById("pulmao-var").value) || 0;
  const tempoMin = parseFloat(document.getElementById("pulmao-tempo").value) || 0;

  const dqBase = Math.abs(qin - qout);
  const dqVar = qin * (varPct / 100);
  const dqTotal = dqBase + dqVar;
  const tempoH = tempoMin / 60;
  const volM3 = dqTotal * tempoH;
  const volL = volM3 * 1000;

  document.getElementById("pulmao-dqbase").textContent = `${dqBase.toFixed(2)} m³/h`;
  document.getElementById("pulmao-dqvar").textContent = `${dqVar.toFixed(2)} m³/h`;
  document.getElementById("pulmao-dqtotal").textContent = `${dqTotal.toFixed(2)} m³/h`;
  document.getElementById("pulmao-vol").textContent = `${volM3.toFixed(3)} m³ (${volL.toFixed(0)} L)`;

  const alertEl = document.getElementById("pulmao-alert");
  if (qout > qin) {
    alertEl.hidden = false;
    alertEl.textContent = "Qout > Qin: o tanque está drenando líquido — o volume calculado é o mínimo para não esvaziar antes do tempo de retenção alvo.";
  } else {
    alertEl.hidden = true;
  }

  DASH.pulmao = `${volM3.toFixed(2)} m³`;
  renderDashboard();
}
["pulmao-qin", "pulmao-qout", "pulmao-var", "pulmao-tempo"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updatePulmao);
});
updatePulmao();

// Balanço de Massa — até 3 correntes de entrada + 1 saída, com verificação de fechamento.
function updateBalanco() {
  const streams = [1, 2, 3].map((n) => ({
    q: parseFloat(document.getElementById(`bal-q${n}`).value) || 0,
    r: parseFloat(document.getElementById(`bal-r${n}`).value) || 0,
    c: parseFloat(document.getElementById(`bal-c${n}`).value) || 0,
  }));
  const qs = parseFloat(document.getElementById("bal-qs").value) || 0;
  const rs = parseFloat(document.getElementById("bal-rs").value) || 0;
  const cs = parseFloat(document.getElementById("bal-cs").value) || 0;

  let massIn = 0;
  let traceIn = 0;
  streams.forEach((s) => {
    const massI = s.q * s.r;
    massIn += massI;
    traceIn += (massI * s.c) / 1e6;
  });
  const massOut = qs * rs;
  const qEsperado = rs > 0 ? massIn / rs : 0;
  const cEsperado = massIn > 0 ? (traceIn / massIn) * 1e6 : 0;
  const erroFechamento = massIn > 0 ? ((massOut - massIn) / massIn) * 100 : 0;

  document.getElementById("bal-massin").textContent = `${massIn.toFixed(1)} kg/h`;
  document.getElementById("bal-massout").textContent = `${massOut.toFixed(1)} kg/h`;
  document.getElementById("bal-qesp").textContent = `${qEsperado.toFixed(3)} m³/h`;
  document.getElementById("bal-cesp").textContent = `${cEsperado.toFixed(2)} ppm`;
  document.getElementById("bal-fechamento").textContent = massIn > 0 ? `${erroFechamento.toFixed(2)} %` : "—";

  const alertEl = document.getElementById("bal-alert");
  if (massIn > 0 && Math.abs(erroFechamento) > 5) {
    alertEl.hidden = false;
    alertEl.textContent = `Fechamento fora da tolerância (${erroFechamento.toFixed(1)}% — limite sugerido ±5%): investigar vazamento, erro de medição ou entrada/saída não contabilizada antes de aceitar o balanço.`;
  } else {
    alertEl.hidden = true;
  }

  DASH.balanco = massIn > 0 ? `${erroFechamento.toFixed(1)}% fechamento` : "—";
  renderDashboard();
}
["bal-q1", "bal-r1", "bal-c1", "bal-q2", "bal-r2", "bal-c2", "bal-q3", "bal-r3", "bal-c3", "bal-qs", "bal-rs", "bal-cs"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateBalanco);
});
updateBalanco();

// Análise Econômica — payback simples/descontado, VPL e TIR (fluxo de caixa anual constante).
function vplDe(taxaFrac, capex, fluxo, vida, valres) {
  let vpl = -capex;
  for (let t = 1; t <= vida; t++) {
    const fc = fluxo + (t === vida ? valres : 0);
    vpl += fc / (1 + taxaFrac) ** t;
  }
  return vpl;
}

function tirDe(capex, fluxo, vida, valres) {
  let lo = -0.99;
  let hi = 10.0;
  const vplLo = vplDe(lo, capex, fluxo, vida, valres);
  const vplHi = vplDe(hi, capex, fluxo, vida, valres);
  if (vplLo * vplHi > 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const vplMid = vplDe(mid, capex, fluxo, vida, valres);
    if (Math.abs(vplMid) < 1e-6) return mid;
    if (vplLo * vplMid < 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (lo + hi) / 2;
}

function paybackDescontadoDe(capex, fluxo, vida, tma) {
  let acumulado = 0;
  for (let t = 1; t <= vida; t++) {
    const fcDesc = fluxo / (1 + tma) ** t;
    acumulado += fcDesc;
    if (acumulado >= capex) {
      const faltavaAntes = capex - (acumulado - fcDesc);
      const fracaoAno = faltavaAntes / fcDesc;
      return (t - 1) + fracaoAno;
    }
  }
  return null;
}

function updateVpl() {
  const capex = parseFloat(document.getElementById("vpl-capex").value) || 0;
  const fluxo = parseFloat(document.getElementById("vpl-fluxo").value) || 0;
  const vida = parseInt(document.getElementById("vpl-vida").value, 10) || 1;
  const tma = (parseFloat(document.getElementById("vpl-tma").value) || 0) / 100;
  const valres = parseFloat(document.getElementById("vpl-valres").value) || 0;

  const paybackSimples = fluxo > 0 ? capex / fluxo : Infinity;
  const paybackDesc = paybackDescontadoDe(capex, fluxo, vida, tma);
  const vpl = vplDe(tma, capex, fluxo, vida, valres);
  const tir = tirDe(capex, fluxo, vida, valres);

  document.getElementById("vpl-pbsimples").textContent = isFinite(paybackSimples) ? `${paybackSimples.toFixed(2)} anos` : "não recupera";
  document.getElementById("vpl-pbdesc").textContent = paybackDesc !== null ? `${paybackDesc.toFixed(2)} anos` : "não recupera";
  document.getElementById("vpl-vpl").textContent = `R$ ${vpl.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  document.getElementById("vpl-tir").textContent = tir !== null ? `${(tir * 100).toFixed(2)} %` : "não determinável";

  const alertEl = document.getElementById("vpl-alert");
  if (vpl < 0 || (tir !== null && tir < tma)) {
    alertEl.hidden = false;
    alertEl.textContent = "Investimento não atrativo à TMA informada (VPL negativo e/ou TIR abaixo da TMA) — reveja premissas de fluxo de caixa, vida útil ou CAPEX antes de aprovar.";
  } else {
    alertEl.hidden = true;
  }

  DASH.vpl = `VPL R$ ${vpl.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  renderDashboard();
}
["vpl-capex", "vpl-fluxo", "vpl-vida", "vpl-tma", "vpl-valres"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateVpl);
});
updateVpl();


// ---------------- CAPEX por Correlação (Sprint H5) ----------------
// Mesma lógica/expoentes da aba "Análise Econômica" (Bloco 5) da planilha:
// custo corrigido = custoBase × (capReal/capBase)^n × (CEPCIatual/CEPCIbase)
const CAPEX_CATEGORIAS = {
  "Vaso de pressão / recipiente": 0.62,
  "Trocador de calor casco-tubo": 0.65,
  "Bomba centrífuga": 0.68,
  "Compressor centrífugo": 0.82,
  "Coluna / torre (casco)": 0.68,
  "Tanque de armazenamento atmosférico": 0.57,
  "Forno / caldeira (fired heater)": 0.77,
  "Torre de resfriamento": 0.68,
  "Pacote compacto / skid (PSA etc.)": 0.65,
  "Outro / genérico (regra dos seis décimos)": 0.60,
};
fillSelect(document.getElementById("capex-categoria"), CAPEX_CATEGORIAS, "Vaso de pressão / recipiente");

let capexItens = [];

function capexCustoCorrigido(item, cepciBase, cepciAtual) {
  const n = CAPEX_CATEGORIAS[item.categoria] ?? 0.6;
  const escala = (item.capBase > 0 && item.capReal > 0) ? Math.pow(item.capReal / item.capBase, n) : 1;
  return item.custoBase * escala * (cepciAtual / cepciBase);
}

function renderCapex() {
  const cepciBase = parseFloat(document.getElementById("capex-cepcibase").value) || 1;
  const cepciAtual = parseFloat(document.getElementById("capex-cepciatual").value) || 1;
  const conting = (parseFloat(document.getElementById("capex-conting").value) || 0) / 100;

  const tbody = document.getElementById("capex-tbody");
  const empty = document.getElementById("capex-empty");
  tbody.innerHTML = "";
  empty.hidden = capexItens.length > 0;

  let subtotal = 0;
  capexItens.forEach((item, idx) => {
    const n = CAPEX_CATEGORIAS[item.categoria] ?? 0.6;
    const corrigido = capexCustoCorrigido(item, cepciBase, cepciAtual);
    subtotal += corrigido;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family:var(--font-body)">${item.tag}</td>
      <td style="font-family:var(--font-body);font-size:0.85em">${item.categoria}</td>
      <td>${n.toFixed(2)}</td>
      <td>R$ ${item.custoBase.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi</td>
      <td>R$ ${corrigido.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi</td>
      <td><button class="row-remove" data-idx="${idx}">remover</button></td>`;
    tbody.appendChild(tr);
  });

  document.querySelectorAll("#capex-tbody .row-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      capexItens.splice(parseInt(btn.dataset.idx, 10), 1);
      renderCapex();
    });
  });

  const total = subtotal * (1 + conting);
  document.getElementById("capex-subtotal").textContent = `R$ ${subtotal.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  document.getElementById("capex-total").textContent = `R$ ${total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;

  DASH.capex = `CAPEX estimado R$ ${total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  renderDashboard();
  return total;
}

document.getElementById("capex-add").addEventListener("click", () => {
  const tag = document.getElementById("capex-tag").value.trim();
  const custoBase = parseFloat(document.getElementById("capex-custobase").value);
  if (!tag || !(custoBase > 0)) return;
  capexItens.push({
    tag,
    categoria: document.getElementById("capex-categoria").value,
    custoBase,
    capBase: parseFloat(document.getElementById("capex-capbase").value) || 0,
    capReal: parseFloat(document.getElementById("capex-capreal").value) || 0,
  });
  document.getElementById("capex-tag").value = "";
  document.getElementById("capex-custobase").value = "";
  document.getElementById("capex-capbase").value = "";
  document.getElementById("capex-capreal").value = "";
  renderCapex();
});
document.getElementById("capex-clear").addEventListener("click", () => {
  capexItens = [];
  renderCapex();
});
["capex-cepcibase", "capex-cepciatual", "capex-conting"].forEach((id) => {
  document.getElementById(id).addEventListener("input", renderCapex);
});
document.getElementById("capex-push").addEventListener("click", () => {
  const total = renderCapex();
  const vplCapex = document.getElementById("vpl-capex");
  vplCapex.value = Math.round(total * 1e6);
  vplCapex.dispatchEvent(new Event("input"));
  const msg = document.getElementById("capex-push-msg");
  msg.hidden = false;
  msg.textContent = `Total de R$ ${total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi copiado para o campo "CAPEX — investimento inicial" do módulo "Econ. Financ.".`;
});
renderCapex();
// Ventosas e VAP — orifício grande (faixa), orifício pequeno (purga contínua) e VAP (alívio de vácuo em transiente).
function orificioGrande(dn) {
  return [dn / 8, dn / 4];
}

function orificioPequeno(qAgua, alfa, pAtm, pOpAbs, cd) {
  const qAr = qAgua * alfa * (pAtm / pOpAbs);
  const dOrif = 14.14 * Math.sqrt(qAr / (cd * pOpAbs));
  const comercial = ORIFICIOS_COMERCIAIS_VENTOSA.find((d) => dOrif <= d) || null;
  return { qAr, dOrif, comercial };
}

function vap(q, pn, pPico, cd) {
  const qAlivio = Math.max(0, q * (1 - pn / pPico));
  const areaCm2 = ((qAlivio / 3600) / (cd * Math.sqrt(2 * 9.81 * pn))) * 10000;
  const bitola = BITOLAS_VAP.find((d) => areaCm2 <= (Math.PI * (d / 10) ** 2) / 4) || null;
  return { qAlivio, areaCm2, bitola };
}

function updateVentosas() {
  const dn = parseFloat(document.getElementById("vent-dn").value) || 0;
  const [loMm, hiMm] = orificioGrande(dn);
  document.getElementById("vent-faixa").textContent = `${loMm.toFixed(1)} a ${hiMm.toFixed(1)} mm`;

  const qAgua = parseFloat(document.getElementById("vent-qagua").value) || 0;
  const alfa = parseFloat(document.getElementById("vent-alfa").value) || 0;
  const pAtm = parseFloat(document.getElementById("vent-patm").value) || 0;
  const pOpAbs = parseFloat(document.getElementById("vent-pop").value) || 1;
  const cdp = parseFloat(document.getElementById("vent-cdp").value) || 0.62;
  const { qAr, dOrif, comercial } = orificioPequeno(qAgua, alfa, pAtm, pOpAbs, cdp);

  document.getElementById("vent-qar").textContent = `${qAr.toFixed(3)} m³/h`;
  document.getElementById("vent-dorif").textContent = `${dOrif.toFixed(2)} mm`;
  document.getElementById("vent-orificom").textContent = comercial !== null ? `${comercial} mm` : "acima da série (verificar catálogo)";

  const alertOrif = document.getElementById("vent-alertorif");
  if (comercial === null) {
    alertOrif.hidden = false;
    alertOrif.textContent = "Diâmetro calculado acima do maior orifício comercial da série (50 mm) — reveja a vazão de ar ou considere múltiplos orifícios/ventosa maior.";
  } else {
    alertOrif.hidden = true;
  }

  const q = parseFloat(document.getElementById("vent-q").value) || 0;
  const pn = parseFloat(document.getElementById("vent-pn").value) || 0;
  const pPico = parseFloat(document.getElementById("vent-ppico").value) || 1;
  const cdv = parseFloat(document.getElementById("vent-cdv").value) || 0.62;
  const { qAlivio, areaCm2, bitola } = vap(q, pn, pPico, cdv);

  document.getElementById("vent-qalivio").textContent = `${qAlivio.toFixed(2)} m³/h`;
  document.getElementById("vent-area").textContent = `${areaCm2.toFixed(3)} cm²`;
  document.getElementById("vent-bitola").textContent = bitola !== null ? `${bitola} mm` : (qAlivio > 0 ? "acima da série (verificar catálogo)" : "—");

  const alertVap = document.getElementById("vent-alertvap");
  if (pn >= pPico) {
    alertVap.hidden = false;
    alertVap.textContent = "PN ≥ pressão de pico do transiente: não há alívio de vácuo a dimensionar nessas condições (Q_alívio = 0).";
  } else if (bitola === null) {
    alertVap.hidden = false;
    alertVap.textContent = "Área requerida acima da maior bitola comercial da série (150 mm) — reveja a vazão/pressões ou considere múltiplas VAPs.";
  } else {
    alertVap.hidden = true;
  }

  DASH.ventosas = comercial !== null ? `orifício ${comercial} mm · VAP ${bitola ?? "—"} mm` : "—";
  renderDashboard();
}
["vent-dn", "vent-qagua", "vent-alfa", "vent-patm", "vent-pop", "vent-cdp", "vent-q", "vent-pn", "vent-ppico", "vent-cdv"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateVentosas);
});
updateVentosas();

// Transientes — golpe de aríete (Joukowsky/Allievi). Item de segurança.
const transTubo = document.getElementById("trans-tubo");
fillSelect(transTubo, TUBOS_TRANSIENTES, "Aço Carbono Sch 40 - 4\" Sch 40");
transTubo.addEventListener("change", updateTransientes);

function celeridadeTubo(tubo) {
  const ePa = tubo.E * 1e9;
  return 1480 / Math.sqrt(1 + (K_AGUA_PA / ePa) * (tubo.di / tubo.e));
}

function updateTransientes() {
  const tubo = TUBOS_TRANSIENTES[transTubo.value];
  const v = parseFloat(document.getElementById("trans-v").value) || 0;
  const l = parseFloat(document.getElementById("trans-l").value) || 0;
  const tf = parseFloat(document.getElementById("trans-tf").value) || 0.001;
  const pServ = parseFloat(document.getElementById("trans-pserv").value) || 0;

  const a = celeridadeTubo(tubo);
  const tc = (2 * l) / a;
  const rapido = tf <= tc;
  const dh = rapido ? (a * v) / 9.81 : (2 * l * v) / (9.81 * tf);
  const pMax = pServ + dh;
  const seguro = pMax <= tubo.pn;

  document.getElementById("trans-a").textContent = `${a.toFixed(1)} m/s`;
  document.getElementById("trans-tc").textContent = `${tc.toFixed(4)} s`;
  document.getElementById("trans-regime").textContent = rapido ? "rápido (Joukowsky)" : "lento (Allievi/Michaud)";
  document.getElementById("trans-dh").textContent = `${dh.toFixed(2)} mca`;
  document.getElementById("trans-pmax").textContent = `${pMax.toFixed(2)} mca (PN = ${tubo.pn} mca)`;

  const alertEl = document.getElementById("trans-alert");
  if (!seguro) {
    alertEl.hidden = false;
    alertEl.textContent = `ALERTA CRÍTICO: pressão máxima (${pMax.toFixed(1)} mca) excede a PN do tubo (${tubo.pn} mca) — risco de ruptura. Aumente o tempo de fechamento, reduza a velocidade, ou especifique tubo/classe de pressão maior antes de operar.`;
  } else {
    alertEl.hidden = true;
  }

  DASH.transientes = `P_máx ${pMax.toFixed(1)} mca (PN ${tubo.pn})${seguro ? "" : " — CRÍTICO"}`;
  renderDashboard();

  // T-522 (2026-09-28): handoff pra Planta Virtual (transientes_golpe_ariete). Chaves = nomes de
  // `parametros` do contrato: tubo_nome (mesmo catálogo TUBOS_TRANSIENTES, string idêntica),
  // L_m, tf_s, P_serv_mca. A velocidade v NÃO vai: no nó ela é a porta de entrada `v_m_s`.
  // Validação sobre os valores brutos (os `|| default` acima mascarariam campo vazio).
  const rL = parseFloat(document.getElementById("trans-l").value);
  const rTf = parseFloat(document.getElementById("trans-tf").value);
  const rP = parseFloat(document.getElementById("trans-pserv").value);
  const transValido = !!tubo && rL > 0 && rTf > 0 && Number.isFinite(rP) && rP >= 0;
  DASH_RAW.transientes = transValido
    ? { tubo_nome: transTubo.value, L_m: rL, tf_s: rTf, P_serv_mca: rP }
    : null;
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("transientes");
}
["trans-v", "trans-l", "trans-tf", "trans-pserv"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateTransientes);
});
updateTransientes();

// ---------------- Navegação por abas ----------------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".module").forEach((m) => (m.hidden = true));
    tab.classList.add("active");
    document.querySelector(`.module[data-module="${tab.dataset.target}"]`).hidden = false;
    tab.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    document.querySelectorAll(".chip").forEach((c) =>
      c.classList.toggle("active", c.dataset.category === tab.dataset.category)
    );
  });
});

// ---------------- Chips de categoria (F4) ----------------
// Pulam direto para o primeiro módulo da categoria, reaproveitando
// irParaModulo (mesma função usada pelos botões "Verificar" de
// Partida/Parada e Inspeção) — o próprio clique no tab já sincroniza
// o chip ativo (ver bloco acima).
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => irParaModulo(chip.dataset.jump));
});
document.querySelector('.chip[data-category="cat-escoamento"]').classList.add("active");

// ---------------- Exportar PDF (memória de cálculo, F1) ----------------
// Estratégia: isolar o módulo visível via CSS de impressão e acionar a
// impressão nativa do navegador ("Salvar como PDF") — funciona offline,
// sem biblioteca extra, e abre igual em celular e computador (mesmo
// formato de saída dos dois lados do projeto unificado).
function exportarPdfModuloAtivo() {
  const ativo = document.querySelector(".module:not([hidden])");
  if (!ativo) return;

  const titulo = ativo.querySelector(".module-title")?.textContent?.trim() ?? "Caderno";
  const desc = ativo.querySelector(".module-desc")?.textContent?.trim() ?? "";
  const agora = new Date();
  const dataHora = agora.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  document.getElementById("printMetaTitle").textContent = titulo;
  document.getElementById("printMetaSub").textContent =
    `Memória de cálculo${desc ? " — " + desc : ""} · gerado em ${dataHora}`;

  document.body.classList.add("printing");
  window.print();
}

document.getElementById("exportPdfBtn").addEventListener("click", exportarPdfModuloAtivo);
window.addEventListener("afterprint", () => document.body.classList.remove("printing"));

// ---------------- Torre de Resfriamento (Merkel) — Sprint H12 / item #1 fila expansão ----------------
// Mesma correlação do build_H12.py (planilha) — h_sat(T) polinomial padrão ASHRAE,
// integração de Chebyshev 4 pontos (Merkel 1925, padrão CTI).
function hSatKjKg(tC) {
  return 2500.9 + 4.7826 * tC + 0.0451 * tC * tC;
}
function caracteristicaTorreMerkel(tQuente, tFria, tBulbo, lg) {
  const range = tQuente - tFria;
  if (range <= 0) return null;
  const fracoes = [0.1, 0.4, 0.6, 0.9];
  const hArEntrada = hSatKjKg(tBulbo);
  let somaInversoDh = 0;
  for (const f of fracoes) {
    const tAgua = tFria + f * range;
    const hAguaSat = hSatKjKg(tAgua);
    const hArOperacao = hArEntrada + lg * (tAgua - tFria);
    const dh = hAguaSat - hArOperacao;
    if (dh <= 0) return null; // força motriz inválida
    somaInversoDh += 1 / dh;
  }
  return (range / 4) * somaInversoDh;
}
function updateTorre() {
  const tQuente = parseFloat(document.getElementById("torre-tq").value) || 0;
  const tFria = parseFloat(document.getElementById("torre-tf").value) || 0;
  const tBulbo = parseFloat(document.getElementById("torre-tbu").value) || 0;
  const cDisp = parseFloat(document.getElementById("torre-cdisp").value) || 0;
  const l = parseFloat(document.getElementById("torre-l").value) || 1;
  const g = parseFloat(document.getElementById("torre-g").value) || 1;

  const lg = l / g;
  const range = tQuente - tFria;
  const approach = tFria - tBulbo;
  const cReq = caracteristicaTorreMerkel(tQuente, tFria, tBulbo, lg);

  document.getElementById("torre-lg").textContent = lg.toFixed(4);
  document.getElementById("torre-range").textContent = `${range.toFixed(1)} °C`;
  document.getElementById("torre-approach").textContent = `${approach.toFixed(1)} °C`;

  const alertEl = document.getElementById("torre-alert");
  if (cReq === null) {
    document.getElementById("torre-creq").textContent = "—";
    alertEl.hidden = false;
    alertEl.textContent = "Força motriz de entalpia não-positiva — approach/L-G incompatíveis com o bulbo úmido informado.";
    DASH.torre = "—";
    DASH_RAW.torre = null;
  } else {
    document.getElementById("torre-creq").textContent = cReq.toFixed(4);
    const margem = cDisp - cReq;
    if (margem >= 0) {
      alertEl.hidden = true;
    } else {
      alertEl.hidden = false;
      alertEl.textContent = `Torre subdimensionada: C_disp (${cDisp.toFixed(4)}) < C_req (${cReq.toFixed(4)}).`;
    }
    DASH.torre = `C_req=${cReq.toFixed(4)} (${margem >= 0 ? "OK" : "insuficiente"})`;
    // Dado cru pro handoff (2026-09-11) -- nomes já escolhidos pra bater
    // 1:1 com CONFIG_TORRE_RESFRIAMENTO_01 na Planta Virtual (C_alvo,
    // L_sobre_G); os 3 primeiros são contexto (não usados no mapeamento
    // desta rodada, mas exportados por completude/depuração).
    DASH_RAW.torre = {
      T_agua_quente_c: tQuente,
      T_agua_fria_c: tFria,
      T_bulbo_umido_c: tBulbo,
      L_sobre_G: lg,
      C_alvo: cReq,
    };
  }
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("torre");
  if (typeof renderDashboard === "function") renderDashboard();
}
["torre-tq", "torre-tf", "torre-tbu", "torre-cdisp", "torre-l", "torre-g"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateTorre)
);

// ---------------- Válvula JT + Hidrato — Sprint H13 / item #3 fila expansão ----------------
// PARTE 1 (hidrato, alta confiança): Motiee (1991), fórmula publicada direta.
// PARTE 2 (JT, confiança menor): mu_JT via fator Z de Beggs&Brill (mesmo já usado
// em Darcy-Weisbach/Hazen-Williams), Cp aproximado por k=Cp/Cv=1,30 (valor típico,
// não composicional) — ver nota completa na aba correspondente da planilha.
function fatorZBeggsBrill(tPr, pPr) {
  const A = 1.39 * Math.pow(tPr - 0.92, 0.5) - 0.36 * tPr - 0.101;
  const B = (0.62 - 0.23 * tPr) * pPr + (0.066 / (tPr - 0.86) - 0.037) * pPr * pPr
    + (0.32 * Math.pow(pPr, 6)) / Math.pow(10, 9 * (tPr - 1));
  const C = 0.132 - 0.32 * Math.log10(tPr);
  const D = Math.pow(10, 0.3106 - 0.49 * tPr + 0.1824 * tPr * tPr);
  return A + (1 - A) / Math.exp(B) + C * Math.pow(pPr, D);
}
function propriedadesPseudocriticasSutton(gamma) {
  const tPc = 169.2 + 349.5 * gamma - 74.0 * gamma * gamma;
  const pPc = 756.8 - 131.0 * gamma - 3.6 * gamma * gamma;
  return [tPc, pPc];
}
function coeficienteJT(tRankine, pPsia, gamma) {
  const R = 10.7316;
  const k = 1.30;
  const [tPc, pPc] = propriedadesPseudocriticasSutton(gamma);
  const tPr = tRankine / tPc;
  const pPr = pPsia / pPc;
  const Z = fatorZBeggsBrill(tPr, pPr);
  const dT = 1.0;
  const ZMais = fatorZBeggsBrill((tRankine + dT) / tPc, pPr);
  const dZdT = (ZMais - Z) / dT;
  const cpMolar = (R * k) / (k - 1);
  return ((R * tRankine * tRankine) / (cpMolar * pPsia)) * dZdT;
}
function quedaTemperaturaJT(t1Rankine, p1Psia, p2Psia, gamma, nPassos) {
  nPassos = nPassos || 20;
  let t = t1Rankine;
  let p = p1Psia;
  const dP = (p1Psia - p2Psia) / nPassos;
  for (let i = 0; i < nPassos; i++) {
    const mu = coeficienteJT(t, p, gamma);
    t = t - mu * dP;
    p = p - dP;
  }
  return t;
}
function temperaturaHidratoMotieeF(pPsia, gamma) {
  const A0 = -238.24469, A1 = 78.99181, A2 = -5.352544;
  const B1 = 349.47324, B2 = -150.85396;
  const C1 = -27.604065;
  const log10P = Math.log10(pPsia);
  return A0 + A1 * log10P + A2 * log10P * log10P
    + B1 * gamma + B2 * gamma * gamma
    + C1 * gamma * log10P;
}
function updateJTHid() {
  const t1F = parseFloat(document.getElementById("jthid-t1").value) || 0;
  const p1 = parseFloat(document.getElementById("jthid-p1").value) || 1;
  const p2 = parseFloat(document.getElementById("jthid-p2").value) || 1;
  const gamma = parseFloat(document.getElementById("jthid-gamma").value) || 0.65;

  const alertEl = document.getElementById("jthid-alert");
  if (p2 >= p1) {
    document.getElementById("jthid-t2").textContent = "—";
    document.getElementById("jthid-dt").textContent = "—";
    document.getElementById("jthid-thid").textContent = "—";
    document.getElementById("jthid-margem").textContent = "—";
    alertEl.hidden = false;
    alertEl.textContent = "P2 deve ser menor que P1 (expansão, não compressão).";
    DASH.jthid = "—";
    DASH_RAW.jthid = null;
    if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("jthid");
    if (typeof renderDashboard === "function") renderDashboard();
    return;
  }

  const t1Rankine = t1F + 459.67;
  const t2Rankine = quedaTemperaturaJT(t1Rankine, p1, p2, gamma, 20);
  const t2F = t2Rankine - 459.67;
  const tHidF = temperaturaHidratoMotieeF(p2, gamma);
  const margem = t2F - tHidF;

  document.getElementById("jthid-t2").textContent = `${t2F.toFixed(1)} °F`;
  document.getElementById("jthid-dt").textContent = `${(t1F - t2F).toFixed(1)} °F`;
  document.getElementById("jthid-thid").textContent = `${tHidF.toFixed(1)} °F`;
  document.getElementById("jthid-margem").textContent = `${margem.toFixed(1)} °F`;

  if (margem < 0) {
    alertEl.hidden = false;
    alertEl.textContent = `Risco de formação de hidrato — T2 (${t2F.toFixed(1)}°F) abaixo da T de hidrato (${tHidF.toFixed(1)}°F).`;
  } else {
    alertEl.hidden = true;
  }
  DASH.jthid = `T2=${t2F.toFixed(1)}°F (margem ${margem >= 0 ? "+" : ""}${margem.toFixed(1)}°F)`;
  // Dado cru pro handoff (2026-09-12, generalização da ponte) -- nomes
  // escolhidos pra bater 1:1 com as chaves que `_simular_valvula_jt()`
  // de fato lê de `ponto_camada1` na Planta Virtual (T1_F, P1_psia,
  // P2_psia, gamma_gas) -- confirmado direto no código
  // (camada2_fisica.py), não presumido. Diferente do caso da torre, os
  // 4 campos aqui são TODOS lidos pela física em runtime -- nenhum é
  // só contexto/depuração.
  DASH_RAW.jthid = { T1_F: t1F, P1_psia: p1, P2_psia: p2, gamma_gas: gamma };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("jthid");
  if (typeof renderDashboard === "function") renderDashboard();
}
["jthid-t1", "jthid-p1", "jthid-p2", "jthid-gamma"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateJTHid)
);

// ---------------- Rede com Loops (Hardy Cross) — Sprint H14 / item #7 fila expansão ----------------
// Topologia fixa: N1(fonte)->N2->N3, N1->N4->N3, N2-N4 diagonal compartilhada entre 2 loops.
// ESCOPO: topologia fixa, não solver genérico (mesmo escopo reduzido do build_H14.py/Motor-24).
function resolverHardyCrossFixo(K, Q0, n, maxIter, tol) {
  maxIter = maxIter || 50;
  tol = tol || 1e-8;
  // Q = {N1N2, N2N3, N1N4, N4N3, N2N4}
  const Q = { ...Q0 };
  const historico = [];
  let iteracao = 0;
  for (; iteracao < maxIter; iteracao++) {
    const termoNum = (nome, neg) => {
      const q = Q[nome];
      const v = K[nome] * q * Math.pow(Math.abs(q), n - 1);
      return neg ? -v : v;
    };
    const termoDen = (nome) => n * K[nome] * Math.pow(Math.abs(Q[nome]), n - 1);

    const numA = termoNum("N1N2", false) + termoNum("N2N4", false) + termoNum("N1N4", true);
    const denA = termoDen("N1N2") + termoDen("N2N4") + termoDen("N1N4");
    const deltaA = denA === 0 ? 0 : -numA / denA;

    const numB = termoNum("N2N3", false) + termoNum("N4N3", true) + termoNum("N2N4", true);
    const denB = termoDen("N2N3") + termoDen("N4N3") + termoDen("N2N4");
    const deltaB = denB === 0 ? 0 : -numB / denB;

    Q.N1N2 += deltaA;
    Q.N1N4 -= deltaA;
    Q.N2N4 += deltaA - deltaB;
    Q.N2N3 += deltaB;
    Q.N4N3 -= deltaB;

    const fechamento = Math.max(Math.abs(numA), Math.abs(numB));
    historico.push(fechamento);
    if (fechamento < tol) {
      iteracao++;
      break;
    }
  }
  return { Q, iteracoes: iteracao, historico };
}
function updateHardyCross() {
  const K = {
    N1N2: parseFloat(document.getElementById("hcross-k1").value) || 0.001,
    N2N3: parseFloat(document.getElementById("hcross-k2").value) || 0.001,
    N1N4: parseFloat(document.getElementById("hcross-k3").value) || 0.001,
    N4N3: parseFloat(document.getElementById("hcross-k4").value) || 0.001,
    N2N4: parseFloat(document.getElementById("hcross-k5").value) || 0.001,
  };
  const Q0 = {
    N1N2: parseFloat(document.getElementById("hcross-q1").value) || 0,
    N2N3: parseFloat(document.getElementById("hcross-q2").value) || 0,
    N1N4: parseFloat(document.getElementById("hcross-q3").value) || 0,
    N4N3: parseFloat(document.getElementById("hcross-q4").value) || 0,
    N2N4: parseFloat(document.getElementById("hcross-q5").value) || 0,
  };
  const n = parseFloat(document.getElementById("hcross-n").value) || 1.85;

  const { Q, iteracoes, historico } = resolverHardyCrossFixo(K, Q0, n);
  const fechamentoFinal = historico[historico.length - 1] || 0;

  document.getElementById("hcross-iter").textContent = iteracoes;
  document.getElementById("hcross-fechamento").textContent = fechamentoFinal.toExponential(2);

  const tbody = document.getElementById("hcross-tbody");
  tbody.innerHTML = "";
  const labels = { N1N2: "N1 → N2", N2N3: "N2 → N3", N1N4: "N1 → N4", N4N3: "N4 → N3", N2N4: "N2 → N4 (diagonal)" };
  for (const nome of ["N1N2", "N2N3", "N1N4", "N4N3", "N2N4"]) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${labels[nome]}</td><td class="mono">${Q[nome].toFixed(4)}</td>`;
    tbody.appendChild(tr);
  }

  const alertEl = document.getElementById("hcross-alert");
  if (fechamentoFinal >= 0.01 || !isFinite(fechamentoFinal)) {
    alertEl.hidden = false;
    alertEl.textContent = "Não convergiu dentro de 50 iterações — revisar K's/vazões iniciais (devem respeitar continuidade nos nós).";
  } else {
    alertEl.hidden = true;
  }
  DASH.hcross = `convergiu em ${iteracoes} it. (fechamento ${fechamentoFinal.toExponential(1)})`;
  // Dado cru pro handoff (2026-09-12) -- APROXIMAÇÃO DECLARADA, não
  // mapeamento físico real: a rede aqui (2 loops/5 trechos, K's e Q0's
  // editáveis pelo usuário) NÃO é a mesma topologia da
  // `rede_hardy_cross_01` na Planta Virtual (2 loops/6 trechos, K's e
  // vazões-base cravados no código -- ver
  // `_topologia_rede_hardy_cross_base()` em camada2_fisica.py). Não há
  // tradução campo-a-campo possível entre as 2 (achado registrado em
  // `00_PATCH_ponte-hydrocalc-motor-jthid_2026-09-12.md`). O único
  // parâmetro que `_simular_rede_hardy_cross()` de fato lê é
  // `fator_demanda`, um escalar que multiplica a topologia fixa inteira.
  //
  // TENTATIVA 1 (descartada, acha achada aqui): razão vazão-resolvida /
  // vazão-inicial (Q0) desta mesma rede. Testada numericamente (dobrar
  // todos os Q0 e conferir o resultado) -- é INVARIANTE DE ESCALA,
  // porque a correção de Hardy-Cross (ΔQ ~ K·Q·|Q|^(n-1) no numerador,
  // ~ K·|Q|^(n-1) no denominador) é homogênea de grau 1 em Q: dobrar
  // todo Q0 dobra toda a solução, a razão fica idêntica. Ou seja, essa
  // razão só reflete o DESEQUILÍBRIO entre os K's/Q0's escolhidos, não
  // o quão grande é a demanda -- o oposto do que "fator_demanda" precisa
  // capturar. Descartada por não passar num teste de sanidade básico
  // (não presumida boa, testada e reprovada).
  //
  // TENTATIVA 2 (usada): vazão total resolvida nesta rede (soma de
  // |Q| dos 5 trechos) dividida pela vazão total de referência da
  // topologia FIXA da Planta Virtual (AB+AD = 50+50 = 100, mesmas
  // unidades presumidas -- ver CONFIG/`_topologia_rede_hardy_cross_
  // base()`). Sensível à magnitude que o usuário configurou (ao
  // contrário da Tentativa 1), ao custo de presumir que as 2 redes
  // (diferentes, não relacionadas) usam a mesma convenção de unidade de
  // vazão -- premissa não verificada, declarada aqui e no patch, não
  // escondida.
  const REFERENCIA_VAZAO_TOTAL_PLANTA_VIRTUAL = 100.0; // AB+AD do baseline fixo, ver nota acima
  const qTotal = Object.values(Q).reduce((acc, v) => acc + Math.abs(v), 0);
  const convergiuOk = fechamentoFinal < 0.01 && isFinite(fechamentoFinal);
  DASH_RAW.hcross = convergiuOk
    ? { fator_demanda: qTotal / REFERENCIA_VAZAO_TOTAL_PLANTA_VIRTUAL }
    : null;
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("hcross");
  if (typeof renderDashboard === "function") renderDashboard();
}
["hcross-k1", "hcross-k2", "hcross-k3", "hcross-k4", "hcross-k5",
  "hcross-q1", "hcross-q2", "hcross-q3", "hcross-q4", "hcross-q5", "hcross-n"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateHardyCross)
);

// ---------------- Aminas — Triagem GPSA — Sprint H15 / item #9 fila expansão ----------------
// ESCOPO: triagem preliminar (GPSA Engineering Data Book, Vol. II), não coluna rigorosa
// (Kent-Eisenberg fica fora de escopo). Circulação de amina calculada por balanço de mols/
// loading — alta confiança. Estágios teóricos: não calculado, só faixa de referência (8-14).
// Risco de bulge: classificação qualitativa por faixa de gás ácido, não correlação preditiva
// validada — ver nota completa na aba correspondente da planilha.
const MW_MEA = 61.08;
const MW_MDEA = 119.17;
const LOADING_MAX_MEA = 0.35;
function updateAminas() {
  const tipo = document.getElementById("aminas-tipo").value;
  const qGas = parseFloat(document.getElementById("aminas-qgas").value) || 0;
  const remocao = parseFloat(document.getElementById("aminas-remocao").value) || 0;
  const yH2S = parseFloat(document.getElementById("aminas-yh2s").value) || 0;
  const yCO2 = parseFloat(document.getElementById("aminas-yco2").value) || 0;
  const loading = parseFloat(document.getElementById("aminas-loading").value) || 0.001;
  const concWt = parseFloat(document.getElementById("aminas-concwt").value) || 0.001;
  const densidade = parseFloat(document.getElementById("aminas-densidade").value) || 0;

  const mwAmina = tipo === "MEA" ? MW_MEA : MW_MDEA;
  const yAcido = yH2S + yCO2;
  const nAcidoLbmolHr = (qGas * 1e6 * yAcido * remocao) / 379.3 / 24;
  const lbmolAminaPorGal = (concWt * densidade) / mwAmina;
  const circulacaoGpm = loading > 0 && lbmolAminaPorGal > 0
    ? nAcidoLbmolHr / (loading * lbmolAminaPorGal) / 60
    : 0;

  document.getElementById("aminas-nacido").textContent = `${nAcidoLbmolHr.toFixed(2)} lbmol/h`;
  document.getElementById("aminas-circ").textContent = `${circulacaoGpm.toFixed(1)} gpm`;

  const yAcidoPct = yAcido * 100;
  let bulgeTexto;
  if (yAcidoPct < 2) {
    bulgeTexto = "BAIXO — bulge típico 10-15°F acima da alimentação";
  } else if (yAcidoPct < 6) {
    bulgeTexto = "MÉDIO — bulge pode superar 15-30°F acima da alimentação";
  } else {
    bulgeTexto = "ALTO — caso concentrado, bulge pode superar 50°F";
  }
  document.getElementById("aminas-bulge").textContent = bulgeTexto;

  const alertEl = document.getElementById("aminas-alert");
  if (tipo === "MEA" && loading > LOADING_MAX_MEA) {
    alertEl.hidden = false;
    alertEl.textContent = `Loading informado (${loading.toFixed(2)}) acima do limite prático de corrosão citado na literatura para MEA (~${LOADING_MAX_MEA.toFixed(2)} mol/mol).`;
  } else {
    alertEl.hidden = true;
  }
  DASH.aminas = `${circulacaoGpm.toFixed(0)} gpm (${tipo}, loading ${loading.toFixed(2)})`;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1 confirmado contra
  // contrato_ativo.py, incluindo a string `amina` ("MEA"/"MDEA" batem
  // exato com o que aminas_triagem_gpsa.py aceita). `qGas` (vazão de gás)
  // é porta_entrada dinâmica, não `parametros` -- não enviado. Enviado
  // mesmo quando o alerta de loading acima do limite prático (MEA) está
  // ativo -- é o mesmo dado de entrada, o alerta é sobre risco de
  // corrosão em campo, não invalida o cálculo.
  DASH_RAW.aminas = {
    y_h2s: yH2S, y_co2: yCO2, remocao_fracionaria: remocao,
    loading_mol_mol: loading, conc_amina_wt: concWt,
    densidade_solucao_lb_gal: densidade, amina: tipo,
  };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("aminas");
  if (typeof renderDashboard === "function") renderDashboard();
}
["aminas-tipo", "aminas-qgas", "aminas-remocao", "aminas-yh2s", "aminas-yco2",
  "aminas-loading", "aminas-concwt", "aminas-densidade"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateAminas)
);

// ---------------- Separador API Água-Óleo — Sprint H16 / item #14 fila expansão ----------------
// MÉTODO: Lei de Stokes (gotícula 150 µm) + fator de turbulência F + critério de velocidade
// horizontal máxima 3 ft/min + geometria L/W>=5, D/W 0,3-0,5 (API Publication 421; Arnold &
// Stewart, "Surface Production Operations"). Sem caso publicado ponta a ponta para validar —
// motor Python isolado (separador_api_stokes.py) com 7/7 testes de consistência interna.
const G_SI = 9.80665;
function updateSepAPI() {
  const q = parseFloat(document.getElementById("sepapi-q").value) || 0;
  const rhoAgua = parseFloat(document.getElementById("sepapi-rhoagua").value) || 0;
  const rhoOleo = parseFloat(document.getElementById("sepapi-rhooleo").value) || 0;
  const muAgua = parseFloat(document.getElementById("sepapi-muagua").value) || 0.0001;
  const dGota = parseFloat(document.getElementById("sepapi-dgota").value) || 0.00015;
  const fatorF = parseFloat(document.getElementById("sepapi-fatorf").value) || 1;
  const razaoDW = parseFloat(document.getElementById("sepapi-razaodw").value) || 0.4;

  const alertEl = document.getElementById("sepapi-alert");
  if (rhoAgua <= rhoOleo) {
    alertEl.hidden = false;
    alertEl.textContent = "Densidade da água deve ser maior que a do óleo para o óleo ascender — confira as entradas.";
    ["sepapi-vt", "sepapi-area", "sepapi-geometria", "sepapi-razaolw"].forEach((id) =>
      (document.getElementById(id).textContent = "—")
    );
    DASH_RAW.separador_api = null;
    if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("separador_api");
    return;
  }
  alertEl.hidden = true;

  const vTMs = (G_SI * (rhoAgua - rhoOleo) * dGota ** 2) / (18 * muAgua);
  const vTFtMin = vTMs * 3.28084 / (1 / 60);
  const qFt3Min = (q * 35.3147) / 60;
  const aHBasica = qFt3Min / vTFtMin;
  const aHProjeto = aHBasica * fatorF;

  const vHMaxFtMin = 3.0;
  const W = Math.sqrt(qFt3Min / (vHMaxFtMin * razaoDW));
  const D = razaoDW * W;
  const L = aHProjeto / W;
  const razaoLW = L / W;

  document.getElementById("sepapi-vt").textContent = `${vTFtMin.toFixed(4)} ft/min`;
  document.getElementById("sepapi-area").textContent = `${aHProjeto.toFixed(1)} ft²`;
  document.getElementById("sepapi-geometria").textContent = `${W.toFixed(2)} × ${D.toFixed(2)} × ${L.toFixed(2)} ft`;
  document.getElementById("sepapi-razaolw").textContent = razaoLW.toFixed(2);

  if (razaoLW < 5) {
    alertEl.hidden = false;
    alertEl.textContent = `Razão L/W = ${razaoLW.toFixed(2)} abaixo do critério mínimo (5:1) — ajustar geometria ou fator F.`;
  }
  DASH.sepapi = `${L.toFixed(1)}×${W.toFixed(1)}×${D.toFixed(1)} ft (L/W ${razaoLW.toFixed(1)})`;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1: os 5 campos batem
  // direto com os `parametros` do ContratoAtivo `separador_api_stokes`
  // (confirmado em contrato_ativo.py). `d_gota` (150µm) é constante fixa
  // do método, não é `parametros` do contrato -- não enviado.
  DASH_RAW.separador_api = {
    rho_agua_kg_m3: rhoAgua, rho_oleo_kg_m3: rhoOleo, mu_agua_pa_s: muAgua,
    fator_turbulencia_F: fatorF, razao_D_W: razaoDW,
  };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("separador_api");
  if (typeof renderDashboard === "function") renderDashboard();
}
["sepapi-q", "sepapi-rhoagua", "sepapi-rhooleo", "sepapi-muagua", "sepapi-dgota",
  "sepapi-fatorf", "sepapi-razaodw"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateSepAPI)
);

// ---------------- Proteção Catódica — Sprint H17 / item #15 fila expansão ----------------
// MÉTODO: densidade de corrente x área = corrente total. Ânodo de sacrifício pelo balanço
// massa-vida-corrente (Lei de Faraday). Fonte: NACE SP0169. Sem caso publicado ponta a ponta —
// motor Python isolado (protecao_catodica.py) com 7/7 testes de consistência interna.
const CONSUMO_KG_A_ANO = { "Zinco": 11.2, "Alumínio": 3.5, "Magnésio": 7.9 };
function updateCatodica() {
  const area = parseFloat(document.getElementById("catodica-area").value) || 0;
  const densidade = parseFloat(document.getElementById("catodica-densidade").value) || 0;
  const material = document.getElementById("catodica-material").value;
  const vida = parseFloat(document.getElementById("catodica-vida").value) || 0;
  const fatorU = parseFloat(document.getElementById("catodica-fatoru").value) || 0.01;
  const massaUnit = parseFloat(document.getElementById("catodica-massaunit").value) || 0.01;

  const iTotal = (area * densidade) / 1000;
  const consumo = CONSUMO_KG_A_ANO[material];
  const massaTotal = (iTotal * vida * consumo) / fatorU;
  const nAnodos = Math.ceil(massaTotal / massaUnit);

  document.getElementById("catodica-itotal").textContent = `${iTotal.toFixed(2)} A`;
  document.getElementById("catodica-anodos").textContent = `${massaTotal.toFixed(0)} kg / ${nAnodos} un.`;
  document.getElementById("catodica-retificador").textContent = `${iTotal.toFixed(2)} A`;
  DASH.catodica = `${iTotal.toFixed(1)} A (${material}, ${nAnodos} ânodos)`;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1 confirmado contra
  // contrato_ativo.py (inclusive a string do material, "Zinco"/"Alumínio"/
  // "Magnésio" batem exato com CONSUMO_KG_POR_A_ANO do módulo Python).
  DASH_RAW.protecao_catodica = {
    densidade_corrente_ma_m2: densidade, vida_anos: vida, material: material,
    fator_utilizacao: fatorU, massa_unitaria_kg: massaUnit,
  };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("protecao_catodica");
  if (typeof renderDashboard === "function") renderDashboard();
}
["catodica-area", "catodica-densidade", "catodica-material", "catodica-vida",
  "catodica-fatoru", "catodica-massaunit"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateCatodica)
);

// ---------------- Medição Fiscal — Placa de Orifício — Sprint H18 / item #16 fila expansão ----------------
// MÉTODO: Reader-Harris/Gallagher (ISO 5167-2 eq. 4) + iteração de ponto fixo Cd<->Re_D.
// Fontes: ISO 5167-2:2003; AGA-3/API MPMS Cap. 14.3. Sem caso publicado ponta a ponta — motor
// Python isolado (placa_orificio_iso5167.py) com 7/7 testes, Cd validado contra a planilha.
function coefDescargaRHG(beta, reD, tapType) {
  let L1, L2p;
  if (tapType === "corner") { L1 = 0; L2p = 0; }
  else if (tapType === "D_D2") { L1 = 1; L2p = 0.47; }
  else { L1 = 0.254; L2p = 0.254; }
  const A = Math.pow(19000 * beta / reD, 0.8);
  const M2p = 2 * L2p / (1 - beta);
  const termo1 = 0.5961 + 0.0261 * beta ** 2 - 0.216 * beta ** 8;
  const termo2 = 0.000521 * Math.pow(1e6 * beta / reD, 0.7);
  const termo3 = (0.0188 + 0.0063 * A) * Math.pow(beta, 3.5) * Math.pow(1e6 / reD, 0.3);
  const termo4 = (0.043 + 0.080 * Math.exp(-10 * L1) - 0.123 * Math.exp(-7 * L1))
    * (1 - 0.11 * A) * (Math.pow(beta, 4) / (1 - Math.pow(beta, 4)));
  const termo5 = -0.031 * (M2p - 0.8 * Math.pow(M2p, 1.1)) * Math.pow(beta, 1.3);
  return termo1 + termo2 + termo3 + termo4 + termo5;
}
function updateOrificio() {
  const tapType = document.getElementById("orificio-tap").value;
  const D = parseFloat(document.getElementById("orificio-D").value) || 0.001;
  const d = parseFloat(document.getElementById("orificio-d").value) || 0.001;
  const dp = parseFloat(document.getElementById("orificio-dp").value) || 0;
  const rho1 = parseFloat(document.getElementById("orificio-rho1").value) || 0.001;
  const mu = parseFloat(document.getElementById("orificio-mu").value) || 0.00001;

  const beta = d / D;
  const alertEl = document.getElementById("orificio-alert");
  if (beta < 0.10 || beta > 0.75) {
    alertEl.hidden = false;
    alertEl.textContent = `β=${beta.toFixed(4)} fora da faixa de validade da correlação (0,10 a 0,75).`;
    ["orificio-beta", "orificio-cd", "orificio-red", "orificio-vazao"].forEach((id) =>
      (document.getElementById(id).textContent = "—")
    );
    DASH_RAW.orificio = null;
    if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("orificio");
    return;
  }

  let cd = 0.6, qm = 0, reD = 1e5;
  for (let i = 0; i < 30; i++) {
    qm = (cd / Math.sqrt(1 - Math.pow(beta, 4))) * (Math.PI / 4) * d ** 2 * Math.sqrt(2 * dp * rho1);
    reD = (4 * qm) / (Math.PI * D * mu);
    const cdNovo = coefDescargaRHG(beta, reD, tapType);
    if (Math.abs(cdNovo - cd) < 1e-10) { cd = cdNovo; break; }
    cd = cdNovo;
  }

  document.getElementById("orificio-beta").textContent = beta.toFixed(4);
  document.getElementById("orificio-cd").textContent = cd.toFixed(6);
  document.getElementById("orificio-red").textContent = reD.toFixed(0);
  document.getElementById("orificio-vazao").textContent = `${qm.toFixed(4)} kg/s (${(qm / rho1 * 3600).toFixed(2)} m³/h)`;

  if (reD <= 4000) {
    alertEl.hidden = false;
    alertEl.textContent = `Re_D=${reD.toFixed(0)} abaixo do regime turbulento (4000) — fora da faixa de validade da correlação.`;
  } else {
    alertEl.hidden = true;
  }
  DASH.orificio = `${qm.toFixed(2)} kg/s (Cd ${cd.toFixed(3)}, β ${beta.toFixed(2)})`;
  // Dado cru pro handoff (2026-09-12) -- único campo que
  // `_simular_placa_orificio()` de fato lê de `ponto_camada1` é `dp_pa`
  // (confirmado em camada2_fisica.py: D/d/rho1/mu/tap_type vêm de
  // CONFIG_PLACA_ORIFICIO_01, característica fixa do instrumento, não
  // do handoff). Unidade já bate direto (Pa nos 2 lados, default do
  // formulário 20000 == default de PONTOS_DEFAULT_POR_TIPO["placa_
  // orificio"]) -- mapeamento 1:1 real, mesmo padrão do jthid.
  DASH_RAW.orificio = { dp_pa: dp };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("orificio");
  if (typeof renderDashboard === "function") renderDashboard();
}
["orificio-tap", "orificio-D", "orificio-d", "orificio-dp", "orificio-rho1", "orificio-mu"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateOrificio)
);

// ---------------- Purgadores — Capacidade Requerida — Sprint H19 / item #17 fila expansão ----------------
// MÉTODO: carga = duty x 3600 / h_fg; capacidade requerida = carga x fator de segurança.
// Fontes: Spirax Sarco Learning Centre Módulo 14; Swagelok Best Practice Doc. 25; ANSI/ASME
// PTC 39.1. ESCOPO REDUZIDO: não seleciona purgador específico (depende de tabela de
// capacidade do fabricante). Motor Python isolado (purgador_capacidade.py) com 5/5 testes.
function updatePurgadores() {
  const duty = parseFloat(document.getElementById("purg-duty").value) || 0.001;
  const hfg = parseFloat(document.getElementById("purg-hfg").value) || 1;
  const fatorSeg = parseFloat(document.getElementById("purg-fatorseg").value) || 1;

  const carga = (duty * 3600) / hfg;
  const capacidade = carga * fatorSeg;

  document.getElementById("purg-carga").textContent = `${carga.toFixed(2)} kg/h`;
  document.getElementById("purg-capacidade").textContent = `${capacidade.toFixed(2)} kg/h`;
  DASH.purgadores = `${capacidade.toFixed(0)} kg/h requerido (fator ${fatorSeg.toFixed(1)}x)`;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1 confirmado contra
  // contrato_ativo.py. `duty` é porta_entrada dinâmica (carga térmica),
  // não `parametros` do contrato -- não enviado.
  DASH_RAW.purgadores = { h_fg_kj_kg: hfg, fator_seguranca: fatorSeg };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("purgadores");
  if (typeof renderDashboard === "function") renderDashboard();
}
["purg-duty", "purg-hfg", "purg-modo", "purg-fatorseg"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updatePurgadores)
);

// ---------------- Tubulação H2 — ASME B31.12 — Sprint H20 / item #18 fila expansão ----------------
// MÉTODO: mesma fórmula de Barlow já usada/validada em updateEsp() (B31.3) — t = P·Do/(2·(S·E+P·Y)).
// CRÍTICO: S deve já vir reduzida pelo Material Performance Factor do B31.12 (fragilização por
// H2) — tabela do MPF não reproduzida aqui (mesma cautela dos itens #6/ACHE e #17/purgadores).
function updateH2Tubulacao() {
  const P = parseFloat(document.getElementById("h2tub-p").value) || 0;
  const Do = parseFloat(document.getElementById("h2tub-do").value) || 1;
  const S = parseFloat(document.getElementById("h2tub-s").value) || 1;
  const E = parseFloat(document.getElementById("h2tub-e").value) || 1;
  const Y = parseFloat(document.getElementById("h2tub-y").value) || 0.4;
  const c = parseFloat(document.getElementById("h2tub-c").value) || 0;

  const alertEl = document.getElementById("h2tub-alert");
  const denom = S * E + P * Y;
  if (denom <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Combinação de parâmetros inválida (denominador ≤ 0) — revise S, E ou Y.";
    ["h2tub-t", "h2tub-tm", "h2tub-tnom"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }

  const t = (P * Do) / (2 * denom);
  const tm = t + c;
  const tnom = tm / 0.875;

  document.getElementById("h2tub-t").textContent = `${t.toFixed(3)} mm`;
  document.getElementById("h2tub-tm").textContent = `${tm.toFixed(3)} mm`;
  document.getElementById("h2tub-tnom").textContent = `${tnom.toFixed(3)} mm`;

  if (t > Do / 6) {
    alertEl.hidden = false;
    alertEl.textContent = "t calculado > Do/6 — fora da faixa de validade do coeficiente Y tabulado para parede fina; usar a formulação de parede espessa do B31.12.";
  } else {
    alertEl.hidden = true;
  }
  DASH.h2tub = `t=${tm.toFixed(2)}mm (P=${P}MPa, S já-reduzida=${S}MPa)`;
  if (typeof renderDashboard === "function") renderDashboard();
}
["h2tub-p", "h2tub-do", "h2tub-s", "h2tub-e", "h2tub-y", "h2tub-c"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateH2Tubulacao)
);

// ---------------- Proteção Contra Incêndio — Sprint H21 / item #19 fila (fecha bloco #14-19) ----------------
// MÉTODO: Parte A (bomba, NFPA 20) vazão=densidade×área; TDH=hgeo+Hazen-Williams+h_residual;
// critério de curva (150%>=65%, churn<=140%) verificado contra pontos do fabricante. Parte B
// (espuma, NFPA 11) vazão=taxa×área; concentrado=vazão×tempo×%. Sem caso publicado ponta a
// ponta — motor Python isolado (incendio_bomba_espuma.py) com 7/7 testes.
function updateIncendio() {
  const dens = parseFloat(document.getElementById("inc-dens").value) || 0;
  const area = parseFloat(document.getElementById("inc-area").value) || 0;
  const hgeo = parseFloat(document.getElementById("inc-hgeo").value) || 0;
  const L = parseFloat(document.getElementById("inc-l").value) || 1;
  const Chw = parseFloat(document.getElementById("inc-chw").value) || 1;
  const D = parseFloat(document.getElementById("inc-d").value) || 0.001;
  const pres = parseFloat(document.getElementById("inc-pres").value) || 0;

  const vazaoLMin = dens * area;
  const vazaoM3s = vazaoLMin / 1000 / 60;
  const hf = vazaoM3s > 0 ? 10.67 * L * Math.pow(vazaoM3s, 1.852) / (Math.pow(Chw, 1.852) * Math.pow(D, 4.87)) : 0;
  const hRes = (pres * 1000) / (1000 * 9.80665);
  const tdh = hgeo + hf + hRes;

  document.getElementById("inc-vazao").textContent = `${vazaoLMin.toFixed(1)} L/min`;
  document.getElementById("inc-tdh").textContent = `${tdh.toFixed(2)} m`;

  const p100 = parseFloat(document.getElementById("inc-p100").value) || 1;
  const p150 = parseFloat(document.getElementById("inc-p150").value) || 0;
  const pChurn = parseFloat(document.getElementById("inc-pchurn").value) || 0;
  const razao150 = p150 / p100;
  const razaoChurn = pChurn / p100;
  document.getElementById("inc-crit150").textContent = razao150 >= 0.65 ? `OK (${(razao150 * 100).toFixed(0)}%)` : `⚠ NÃO ATENDE (${(razao150 * 100).toFixed(0)}%)`;
  document.getElementById("inc-critchurn").textContent = razaoChurn <= 1.40 ? `OK (${(razaoChurn * 100).toFixed(0)}%)` : `⚠ NÃO ATENDE (${(razaoChurn * 100).toFixed(0)}%)`;

  const taxa = parseFloat(document.getElementById("inc-taxa").value) || 0;
  const areaEsp = parseFloat(document.getElementById("inc-areaesp").value) || 0;
  const tempo = parseFloat(document.getElementById("inc-tempo").value) || 0;
  const pct = parseFloat(document.getElementById("inc-pct").value) || 0.03;

  const vazaoSol = taxa * areaEsp;
  const volSol = vazaoSol * tempo;
  const volConc = volSol * pct;
  const volAgua = volSol - volConc;

  document.getElementById("inc-vazaosol").textContent = `${vazaoSol.toFixed(1)} L/min`;
  document.getElementById("inc-volconc").textContent = `${volConc.toFixed(1)} L`;
  document.getElementById("inc-volagua").textContent = `${volAgua.toFixed(1)} L`;

  DASH.incendio = `TDH ${tdh.toFixed(1)}m, espuma ${volConc.toFixed(0)}L concentrado`;
  // Dado cru pro handoff (2026-09-12) -- único campo que
  // `_simular_bomba_incendio_espuma()` de fato lê de `ponto_camada1` é
  // `area_protegida_m2` (confirmado em camada2_fisica.py), usado tanto
  // pro TDH (Parte A) quanto pro sistema de espuma (Parte B).
  // ACHADO/APROXIMAÇÃO DECLARADA: o formulário do HydroCalc tem 2 campos
  // de área INDEPENDENTES, sem sincronização entre si -- "inc-area"
  // (Parte A, Área de projeto, default 250) e "inc-areaesp" (Parte B,
  // Área a proteger, default 300) -- enquanto o contrato real da Planta
  // Virtual usa 1 único valor pras 2 fórmulas. Mapeado a partir de
  // "inc-area" (Parte A) por ser o campo que alimenta o TDH/vazão da
  // BOMBA em si (o tipo de nó é "bomba de incêndio", não "sistema de
  // espuma") -- "inc-areaesp" não é capturado por este handoff. Não é
  // invenção de equivalência física nova (as 2 áreas descrevem a mesma
  // área real protegida no mundo físico, só duplicada sem link no
  // formulário) mas é uma escolha de qual das 2 usar, por isso
  // declarada aqui e no tooltip do botão, mesmo tratamento do hcross.
  DASH_RAW.incendio = { area_protegida_m2: area };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("incendio");
  if (typeof renderDashboard === "function") renderDashboard();
}
["inc-dens", "inc-area", "inc-hgeo", "inc-l", "inc-chw", "inc-d", "inc-pres",
  "inc-p100", "inc-p150", "inc-pchurn", "inc-taxa", "inc-areaesp", "inc-tempo", "inc-pct"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateIncendio)
);

// ---------------- HRSG — Nível Único de Pressão — Sprint H22 / item #11 fila (esforço Alto) ----------------
// ESCOPO REDUZIDO: só 1 nível de pressão, não a cascata multi-nível de um HRSG completo.
// MÉTODO: balanço de energia + pinch/approach point — vazão de vapor DETERMINADA pelo pinch,
// não é entrada livre. Fontes: ASME PTC 4.4; GPSA Engineering Data Book. Sem caso publicado
// ponta a ponta — motor Python isolado (hrsg_nivel_unico.py) com 6/6 testes.
function updateHRSG() {
  const mgas = parseFloat(document.getElementById("hrsg-mgas").value) || 0.001;
  const tgasin = parseFloat(document.getElementById("hrsg-tgasin").value) || 0;
  const cpgas = parseFloat(document.getElementById("hrsg-cpgas").value) || 0.001;
  const tsat = parseFloat(document.getElementById("hrsg-tsat").value) || 0;
  const hfg = parseFloat(document.getElementById("hrsg-hfg").value) || 0.001;
  const pinch = parseFloat(document.getElementById("hrsg-pinch").value) || 0.001;
  const approach = parseFloat(document.getElementById("hrsg-approach").value) || 0.001;
  const tfw = parseFloat(document.getElementById("hrsg-tfw").value) || 0;
  const cpwater = parseFloat(document.getElementById("hrsg-cpwater").value) || 0.001;
  const deltatsh = parseFloat(document.getElementById("hrsg-deltatsh").value) || 0;
  const cpsh = parseFloat(document.getElementById("hrsg-cpsh").value) || 0.001;

  const tGasEvapExit = tsat + pinch;
  const tWaterEconExit = tsat - approach;

  const alertEl = document.getElementById("hrsg-alert");
  if (tGasEvapExit >= tgasin) {
    alertEl.hidden = false;
    alertEl.textContent = "T_sat + pinch >= T_gas_in — gás não tem energia suficiente para o pinch definido.";
    ["hrsg-msteam", "hrsg-qtotal", "hrsg-tstack"].forEach((id) => (document.getElementById(id).textContent = "—"));
    DASH_RAW.hrsg = null;
    if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("hrsg");
    return;
  }
  if (tWaterEconExit <= tfw) {
    alertEl.hidden = false;
    alertEl.textContent = "T_sat - approach <= T_água_alimentação — approach point inviável.";
    ["hrsg-msteam", "hrsg-qtotal", "hrsg-tstack"].forEach((id) => (document.getElementById(id).textContent = "—"));
    DASH_RAW.hrsg = null;
    if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("hrsg");
    return;
  }

  const mSteam = (mgas * cpgas * (tgasin - tGasEvapExit)) / (hfg + cpsh * deltatsh);
  const qSH = mSteam * cpsh * deltatsh;
  const qEvap = mSteam * hfg;
  const qEcon = mSteam * cpwater * (tWaterEconExit - tfw);
  const qTotal = qSH + qEvap + qEcon;
  const tStack = tGasEvapExit - qEcon / (mgas * cpgas);

  document.getElementById("hrsg-msteam").textContent = `${mSteam.toFixed(3)} kg/s`;
  document.getElementById("hrsg-qtotal").textContent = `${qTotal.toFixed(1)} kW`;
  document.getElementById("hrsg-tstack").textContent = `${tStack.toFixed(1)} °C`;

  if (tStack <= tWaterEconExit) {
    alertEl.hidden = false;
    alertEl.textContent = `Pinch secundário do economizador inviável (T_stack=${tStack.toFixed(1)}°C <= T_água_econ_exit=${tWaterEconExit.toFixed(1)}°C) — revise entradas (mais gás, menor approach, ou água de alimentação mais quente).`;
  } else {
    alertEl.hidden = true;
  }
  DASH.hrsg = `${mSteam.toFixed(2)} kg/s vapor (stack ${tStack.toFixed(0)}°C)`;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1 confirmado contra
  // contrato_ativo.py (9 campos de `parametros`). `mgas`/`tgasin` são
  // portas_entrada dinâmicas (vazão/temperatura do gás), não `parametros`
  // -- não enviados. NÃO reenviado se `pinch_secundario_ok` for falso
  // (alerta ativo mas cálculo completou) -- decisão: deixar passar mesmo
  // assim, é o mesmo dado que a UI já mostra calculado, com o aviso junto.
  DASH_RAW.hrsg = {
    cp_gas_kj_kgk: cpgas, t_sat_c: tsat, h_fg_kj_kg: hfg, pinch_c: pinch,
    approach_c: approach, t_fw_c: tfw, cp_water_kj_kgk: cpwater,
    delta_t_superaquecimento_c: deltatsh, cp_steam_sh_kj_kgk: cpsh,
  };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("hrsg");
  if (typeof renderDashboard === "function") renderDashboard();
}
["hrsg-mgas", "hrsg-tgasin", "hrsg-cpgas", "hrsg-tsat", "hrsg-hfg", "hrsg-pinch",
  "hrsg-approach", "hrsg-tfw", "hrsg-cpwater", "hrsg-deltatsh", "hrsg-cpsh"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateHRSG)
);

// ---------------- Coluna Binária — Prato a Prato — Sprint H23 / item #12 fila (escopo muito reduzido) ----------------
// ESCOPO: item original pedia multicomponente rigoroso (Naphtali-Sandholm/NRTL/UNIQUAC) — fora
// de alcance sem banco de dados termodinâmico. Esta versão: binária, α constante, CMO, stepping
// algébrico (McCabe-Thiele numérico). Fontes: Friday & Smith (1964); Seader/Henley/Roper. Sem
// caso publicado ponta a ponta — motor Python isolado (coluna_binaria_pratos.py) com 7/7 testes.
function equilibrioBinario(x, alpha) { return alpha * x / (1 + (alpha - 1) * x); }
function xAPartirDeY(y, alpha) {
  const denom = alpha - (alpha - 1) * y;
  if (denom <= 0) return null;
  return y / denom;
}
function updateColunaBinaria() {
  const F = parseFloat(document.getElementById("col-f").value) || 0.001;
  const zF = parseFloat(document.getElementById("col-zf").value) || 0.5;
  const xD = parseFloat(document.getElementById("col-xd").value) || 0.95;
  const xW = parseFloat(document.getElementById("col-xw").value) || 0.05;
  const q = parseFloat(document.getElementById("col-q").value) || 1;
  const R = parseFloat(document.getElementById("col-r").value) || 0.01;
  const alpha = parseFloat(document.getElementById("col-alpha").value) || 1.01;

  const alertEl = document.getElementById("col-alert");
  if (!(xW < zF && zF < xD)) {
    alertEl.hidden = false;
    alertEl.textContent = "É necessário xW < zF < xD para o balanço de massa ser fisicamente possível.";
    ["col-vazoes", "col-nest", "col-estalim"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }

  const D = F * (zF - xW) / (xD - xW);
  const W = F - D;
  const L = R * D;
  const V = L + D;
  const Lp = L + q * F;
  const Vp = V - (1 - q) * F;

  if (Vp <= 0 || Lp <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Condição térmica (q) e refluxo resultam em vazão interna negativa na seção de esgotamento.";
    ["col-vazoes", "col-nest", "col-estalim"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }

  document.getElementById("col-vazoes").textContent =
    `D=${D.toFixed(1)} W=${W.toFixed(1)} L=${L.toFixed(1)} V=${V.toFixed(1)} L'=${Lp.toFixed(1)} V'=${Vp.toFixed(1)}`;

  const MAX_ESTAGIOS = 200;
  let xAtual = xD, secao = "retificacao", estagioAlimentacao = null, convergiu = false, nEstagios = 0;
  for (let n = 1; n <= MAX_ESTAGIOS; n++) {
    let yN;
    if (n === 1) {
      yN = xD;
    } else if (secao === "retificacao") {
      yN = (R / (R + 1)) * xAtual + xD / (R + 1);
    } else {
      yN = (Lp / Vp) * xAtual - (W / Vp) * xW;
    }
    const xN = xAPartirDeY(yN, alpha);
    if (xN === null) break;
    nEstagios = n;
    if (xN <= xW) { convergiu = true; break; }
    if (secao === "retificacao" && xN <= zF) { secao = "esgotamento"; estagioAlimentacao = n + 1; }
    xAtual = xN;
  }

  if (convergiu) {
    document.getElementById("col-nest").textContent = `${nEstagios}`;
    document.getElementById("col-estalim").textContent = estagioAlimentacao ? `${estagioAlimentacao}` : "N/D";
    alertEl.hidden = true;
  } else {
    document.getElementById("col-nest").textContent = "NÃO CONVERGIU";
    document.getElementById("col-estalim").textContent = "—";
    alertEl.hidden = false;
    alertEl.textContent = `Não convergiu em ${MAX_ESTAGIOS} estágios — R possivelmente abaixo do refluxo mínimo. Aumente R.`;
  }
  DASH.colunaBinaria = convergiu ? `${nEstagios} estágios (alim. no ${estagioAlimentacao})` : "não convergiu";
  if (typeof renderDashboard === "function") renderDashboard();
}
["col-f", "col-zf", "col-xd", "col-xw", "col-q", "col-r", "col-alpha"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateColunaBinaria)
);

// ---------------- Aminas — Absorção Kremser — Sprint H24 / item #13 fila (escopo alternativo) ----------------
// ESCOPO: item original pedia Kent-Eisenberg (coeficientes sem fonte verificada). Método de
// Kremser (1930), m como entrada do usuário. Fontes: GPSA Cap.19/20; McCabe/Smith/Harriott.
// Sem caso publicado ponta a ponta — motor Python isolado (amina_kremser.py) com 7/7 testes.
function fracaoAbsorvidaKremser(A, N) {
  if (Math.abs(A - 1.0) < 1e-9) return N / (N + 1.0);
  return (Math.pow(A, N + 1) - A) / (Math.pow(A, N + 1) - 1);
}
function updateAminaKremser() {
  const L = parseFloat(document.getElementById("kre-l").value) || 0.001;
  const V = parseFloat(document.getElementById("kre-v").value) || 0.001;
  const m = parseFloat(document.getElementById("kre-m").value) || 0.001;
  const N = parseInt(document.getElementById("kre-n").value) || 1;
  const yin = parseFloat(document.getElementById("kre-yin").value) || 0;
  const xin = parseFloat(document.getElementById("kre-xin").value) || 0;

  const A = L / (m * V);
  const phi = fracaoAbsorvidaKremser(A, N);
  let yout = yin - phi * (yin - m * xin);
  yout = Math.max(yout, 0);

  document.getElementById("kre-a").textContent = A.toFixed(4);
  document.getElementById("kre-phi").textContent = phi.toFixed(4);
  document.getElementById("kre-yout").textContent = yout.toExponential(4);
  DASH.aminaKremser = `φ=${(phi * 100).toFixed(1)}% absorvido (${N} estágios)`;
  // Dado cru pro handoff (2026-09-13) -- nomes de campo IGUAIS aos que
  // `_simular_coluna_absorcao()` lê de `ponto_camada1` (G, y_in, L, m,
  // N_estagios, x_in), pra não precisar de tradução nenhuma no lado do
  // editor (mesmo padrão do dp_pa/area_protegida_m2). V (vazão de gás
  // deste formulário) É o G do Motor-17 -- nomes diferentes, mesma
  // grandeza (vazão molar de gás/vapor que entra na base da coluna).
  DASH_RAW.amina_kremser = { G: V, y_in: yin, L: L, m: m, N_estagios: N, x_in: xin };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("amina_kremser");
  if (typeof renderDashboard === "function") renderDashboard();
}
["kre-l", "kre-v", "kre-m", "kre-n", "kre-yin", "kre-xin"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateAminaKremser)
);

// ---------------- Blowdown — API 521 — Sprint H25 / item #21 fila expansão ----------------
// MÉTODO: escoamento crítico + balanço de massa, temperatura isentrópica. Fonte: API 521
// §5.20 (fórmula padrão de mecânica dos fluidos, não correlação ajustada). Sem caso publicado
// ponta a ponta — motor Python isolado (blowdown_api521.py) com 7/7 testes, dt=1s no JS.
const R_UNIVERSAL_BLOW = 8314.0;
function vazaoMassicaCritica(P, T, MW, k, Cd, A) {
  const Resp = R_UNIVERSAL_BLOW / MW;
  const termo = (k / (Resp * T)) * Math.pow(2 / (k + 1), (k + 1) / (k - 1));
  return Cd * A * P * Math.sqrt(termo);
}
function razaoPressaoCritica(k) { return Math.pow((k + 1) / 2, k / (k - 1)); }
function updateBlowdown() {
  const V = parseFloat(document.getElementById("blow-v").value) || 0.01;
  const P0 = parseFloat(document.getElementById("blow-p0").value) || 1;
  const T0 = parseFloat(document.getElementById("blow-t0").value) || 1;
  const MW = parseFloat(document.getElementById("blow-mw").value) || 1;
  const k = parseFloat(document.getElementById("blow-k").value) || 1.1;
  const Cd = parseFloat(document.getElementById("blow-cd").value) || 0.01;
  const A = parseFloat(document.getElementById("blow-a").value) || 0.000001;
  const Pdown = parseFloat(document.getElementById("blow-pdown").value) || 1;
  const Palvo = parseFloat(document.getElementById("blow-palvo").value) || 1;

  const alertEl = document.getElementById("blow-alert");
  if (Palvo >= P0) {
    alertEl.hidden = false;
    alertEl.textContent = "Pressão alvo deve ser menor que a pressão inicial.";
    document.getElementById("blow-tempo").textContent = "—";
    document.getElementById("blow-criterio").textContent = "—";
    DASH_RAW.blowdown = null;
    if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("blowdown");
    return;
  }

  const razaoCritica = razaoPressaoCritica(k);
  const C = (V * MW * Math.pow(P0, (k - 1) / k)) / (R_UNIVERSAL_BLOW * T0);
  let P = P0, m = C * Math.pow(P0, 1 / k), t = 0;
  const dt = 1, tMax = 900;
  let parouPor = "tempo_maximo_atingido";

  for (let passo = 0; passo < tMax / dt + 1; passo++) {
    if (P <= Palvo) { parouPor = "alvo_atingido"; break; }
    if (P / Pdown < razaoCritica) { parouPor = "escoamento_subcritico"; break; }
    const T = T0 * Math.pow(P / P0, (k - 1) / k);
    const w = vazaoMassicaCritica(P, T, MW, k, Cd, A);
    const mNovo = m - w * dt;
    if (mNovo <= 0) { parouPor = "massa_esgotada"; break; }
    const Pnovo = Math.pow(mNovo / C, k);
    t += dt;
    m = mNovo;
    P = Pnovo;
  }

  if (parouPor === "alvo_atingido") {
    document.getElementById("blow-tempo").textContent = `${t.toFixed(0)} s`;
    document.getElementById("blow-criterio").textContent = t <= 900 ? "OK" : "⚠ REVISAR ORIFÍCIO/ÁREA";
    alertEl.hidden = true;
  } else {
    document.getElementById("blow-tempo").textContent = "NÃO ATINGIU EM 900s";
    document.getElementById("blow-criterio").textContent = "⚠ REVISAR ORIFÍCIO/ÁREA";
    alertEl.hidden = false;
    alertEl.textContent = parouPor === "escoamento_subcritico"
      ? "Escoamento ficou subcrítico antes de atingir o alvo — fora do escopo desta triagem (regime subsônico exigiria fórmula diferente)."
      : "Não atingiu a pressão alvo em 900s — revisar área do orifício ou outras entradas.";
  }
  DASH.blowdown = parouPor === "alvo_atingido" ? `${t.toFixed(0)}s até o alvo` : parouPor;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1 pros 8 campos que
  // a UI expõe; `t_max_s`/`dt_s` não são campo de formulário (a UI usa os
  // mesmos valores fixos 900/1 que o loop acima já usa pra calcular --
  // enviados como constante pra bater com o resultado já mostrado na
  // tela). `P0` não é `parametros` do contrato (é porta_entrada dinâmica,
  // pressão inicial do vaso) -- não enviado. Enviado mesmo quando o
  // resultado não atingiu o alvo (parouPor != "alvo_atingido") -- é o
  // mesmo conjunto de entradas que a Planta Virtual reproduziria de
  // forma determinística, não é dado inválido, só um resultado que não
  // convergiu pro alvo.
  DASH_RAW.blowdown = {
    V_m3: V, T0_k: T0, MW_kg_kmol: MW, k: k, Cd: Cd, A_m2: A,
    P_downstream_pa: Pdown, P_alvo_pa: Palvo, t_max_s: tMax, dt_s: dt,
  };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("blowdown");
  if (typeof renderDashboard === "function") renderDashboard();
}
["blow-v", "blow-p0", "blow-t0", "blow-mw", "blow-k", "blow-cd", "blow-a", "blow-pdown", "blow-palvo"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateBlowdown)
);

// ---------------- Silo — Diâmetro Crítico Jenike — Sprint H26 / item #24 fila (escopo reduzido) ----------------
// MÉTODO: B_crit = H(θ)·σc/(ρ_bulk·g). Só a parte de arqueamento — ângulo do hopper (cartas
// gráficas de Jenike) NÃO calculado. Fontes: Jenike (1964); Rhodes; Schulze. Motor Python
// isolado (silo_jenike.py) com 6/6 testes.
function updateSiloJenike() {
  const sigmac = parseFloat(document.getElementById("silo-sigmac").value) || 0.001;
  const rho = parseFloat(document.getElementById("silo-rho").value) || 0.001;
  const H = parseFloat(document.getElementById("silo-h").value) || 0.001;
  const g = 9.80665;
  const Bcrit = (H * (sigmac * 1000)) / (rho * g);
  document.getElementById("silo-bcrit").textContent = `${Bcrit.toFixed(3)} m`;
  DASH.siloJenike = `B_crit=${Bcrit.toFixed(2)}m`;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1 confirmado contra
  // contrato_ativo.py.
  DASH_RAW.silo_jenike = { sigma_c_kpa: sigmac, densidade_bulk_kg_m3: rho, H_theta: H };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("silo_jenike");
  if (typeof renderDashboard === "function") renderDashboard();
}
["silo-sigmac", "silo-rho", "silo-h"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateSiloJenike)
);

// ---------------- GNL/GLP — Boil-off — Sprint H27 / item #25 fila expansão ----------------
// MÉTODO: Q=k·A·ΔT/L (Fourier); BOR=(Q·86400/(hfg·1000))/massa×100. Sem norma-mestra única —
// física básica, não correlação ajustada. Motor Python isolado (boiloff_gnl.py) com 6/6 testes.
function updateBoiloff() {
  const A = parseFloat(document.getElementById("boil-a").value) || 0.001;
  const k = parseFloat(document.getElementById("boil-k").value) || 0.0001;
  const esp = parseFloat(document.getElementById("boil-esp").value) || 0.001;
  const hfg = parseFloat(document.getElementById("boil-hfg").value) || 1;
  const Tamb = parseFloat(document.getElementById("boil-tamb").value) || 0;
  const Tarm = parseFloat(document.getElementById("boil-tarm").value) || 0;
  const massa = parseFloat(document.getElementById("boil-massa").value) || 1;

  const alertEl = document.getElementById("boil-alert");
  if (Tamb <= Tarm) {
    alertEl.hidden = false;
    alertEl.textContent = "Temperatura ambiente deve ser maior que a de armazenamento.";
    ["boil-q", "boil-taxa", "boil-bor"].forEach((id) => (document.getElementById(id).textContent = "—"));
    DASH_RAW.boiloff = null;
    if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("boiloff");
    return;
  }
  alertEl.hidden = true;

  const Q = (k * A * (Tamb - Tarm)) / esp;
  const taxaMassica = (Q * 86400) / (hfg * 1000);
  const bor = (taxaMassica / massa) * 100;

  document.getElementById("boil-q").textContent = `${Q.toFixed(2)} W`;
  document.getElementById("boil-taxa").textContent = `${taxaMassica.toFixed(3)} kg/dia`;
  document.getElementById("boil-bor").textContent = `${bor.toFixed(5)} %/dia`;
  DASH.boiloff = `BOR ${bor.toFixed(4)}%/dia`;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1 pros 5 campos que
  // são `parametros` do contrato. `Tamb` (ambiente) e `massa` (estoque)
  // são portas_entrada dinâmicas, não `parametros` -- não enviados.
  DASH_RAW.boiloff = {
    A_m2: A, k_isolamento_w_mk: k, espessura_m: esp,
    T_armazenamento_c: Tarm, h_fg_kj_kg: hfg,
  };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("boiloff");
  if (typeof renderDashboard === "function") renderDashboard();
}
["boil-a", "boil-k", "boil-esp", "boil-hfg", "boil-tamb", "boil-tarm", "boil-massa"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateBoiloff)
);

// ---------------- Coluna Recheio — Diâmetro — Sprint H28 / item #26 fila (escopo muito reduzido) ----------------
// MÉTODO: u_flood=C_sf·√((ρL−ρV)/ρV) (Souders-Brown generalizado). C-factor é entrada direta
// do catálogo do fabricante — não deriva da geometria (isso exigiria RBF completo, sem fonte
// confiável nesta sessão). Motor Python isolado (coluna_recheio_diametro.py) com 6/6 testes.
function updateColunaRecheio() {
  const Qv = parseFloat(document.getElementById("rech-qv").value) || 0.001;
  const Csf = parseFloat(document.getElementById("rech-csf").value) || 0.0001;
  const rhoL = parseFloat(document.getElementById("rech-rhol").value) || 0.1;
  const rhoV = parseFloat(document.getElementById("rech-rhov").value) || 0.01;
  const frac = parseFloat(document.getElementById("rech-frac").value) || 0.5;

  const alertEl = document.getElementById("rech-alert");
  if (rhoL <= rhoV) {
    alertEl.hidden = false;
    alertEl.textContent = "Densidade do líquido deve ser maior que a do vapor.";
    ["rech-vel", "rech-diametro"].forEach((id) => (document.getElementById(id).textContent = "—"));
    DASH_RAW.coluna_recheio = null;
    if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("coluna_recheio");
    return;
  }
  alertEl.hidden = true;

  const uFlood = Csf * Math.sqrt((rhoL - rhoV) / rhoV);
  const uOp = uFlood * frac;
  const area = Qv / uOp;
  const D = Math.sqrt((4 * area) / Math.PI);

  document.getElementById("rech-vel").textContent = `flood ${uFlood.toFixed(4)} / op ${uOp.toFixed(4)} m/s`;
  document.getElementById("rech-diametro").textContent = `${D.toFixed(3)} m`;
  DASH.colunaRecheio = `D=${D.toFixed(2)}m`;
  // Dado cru pro handoff (2026-09-14) -- mapeamento 1:1 confirmado contra
  // contrato_ativo.py. `Qv` (vazão volumétrica) é porta_entrada dinâmica,
  // não `parametros` -- não enviado.
  DASH_RAW.coluna_recheio = {
    C_sf_m_s: Csf, rho_L_kg_m3: rhoL, rho_V_kg_m3: rhoV, fracao_inundacao: frac,
  };
  if (typeof atualizarBotaoHandoff === "function") atualizarBotaoHandoff("coluna_recheio");
  if (typeof renderDashboard === "function") renderDashboard();
}
["rech-qv", "rech-csf", "rech-rhol", "rech-rhov", "rech-frac"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateColunaRecheio)
);

// ---------------- CO2 CCS — Peng-Robinson — Sprint H29 / item #27 fila (ÚLTIMO ITEM) ----------------
// ESCOPO REDUZIDO: mesma decisão do Motor-25 (REATORES) — PR-EOS em vez de Span-Wagner/GERG-2008.
// Tc/Pc/ω do CO2 são dado de componente puro publicado (não parâmetro de interação binária).
// VALIDAÇÃO: mesma limitação do Motor-25 — sem dado experimental, só propriedades matemáticas
// internas do PR-EOS. Motor Python isolado (co2_peng_robinson.py) com 6/6 testes.
const TC_CO2 = 304.13, PC_CO2 = 7377300.0, OMEGA_CO2 = 0.22394, MW_CO2 = 44.01, R_CO2 = 8.314;
function pengRobinsonZ(T, P) {
  const kappa = 0.37464 + 1.54226 * OMEGA_CO2 - 0.26992 * OMEGA_CO2 ** 2;
  const Tr = T / TC_CO2;
  const alpha = Math.pow(1 + kappa * (1 - Math.sqrt(Tr)), 2);
  const a = 0.45724 * (R_CO2 ** 2 * TC_CO2 ** 2) / PC_CO2;
  const b = 0.07780 * (R_CO2 * TC_CO2) / PC_CO2;
  const A = (a * alpha * P) / (R_CO2 ** 2 * T ** 2);
  const B = (b * P) / (R_CO2 * T);
  const c2 = -(1 - B), c1 = A - 3 * B ** 2 - 2 * B, c0 = -(A * B - B ** 2 - B ** 3);
  const f = (Z) => Z ** 3 + c2 * Z ** 2 + c1 * Z + c0;
  const fp = (Z) => 3 * Z ** 2 + 2 * c2 * Z + c1;
  let Z = 1.0;
  for (let i = 0; i < 100; i++) {
    const fZ = f(Z);
    if (Math.abs(fZ) < 1e-12) break;
    const dZ = fZ / fp(Z);
    Z -= dZ;
    if (Math.abs(dZ) < 1e-12) break;
  }
  return Z;
}
function updateCO2CCS() {
  const T = parseFloat(document.getElementById("co2-t").value) || 1;
  const P = parseFloat(document.getElementById("co2-p").value) || 1;

  const alertEl = document.getElementById("co2-alert");
  const Z = pengRobinsonZ(T, P);
  if (Z <= 0) {
    alertEl.hidden = false;
    alertEl.textContent = "Raiz de Z não-física (<=0) — fora da faixa de aplicabilidade deste módulo reduzido.";
    ["co2-z", "co2-dens", "co2-desvio"].forEach((id) => (document.getElementById(id).textContent = "—"));
    return;
  }
  alertEl.hidden = true;

  const mwKg = MW_CO2 / 1000;
  const densReal = (P * mwKg) / (Z * R_CO2 * T);
  const densIdeal = (P * mwKg) / (R_CO2 * T);
  const desvio = ((densReal - densIdeal) / densIdeal) * 100;

  document.getElementById("co2-z").textContent = Z.toFixed(4);
  document.getElementById("co2-dens").textContent = `${densReal.toFixed(2)} kg/m³`;
  document.getElementById("co2-desvio").textContent = `${desvio.toFixed(1)} %`;
  DASH.co2ccs = `Z=${Z.toFixed(3)}, ρ=${densReal.toFixed(0)}kg/m³`;
  if (typeof renderDashboard === "function") renderDashboard();
}
["co2-t", "co2-p"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateCO2CCS)
);

// ---------------- Inicialização ----------------
updateDW();
updateHW();
renderSK();
renderRede();
renderPiezo();
updateBomba();
updateTorre();
updateJTHid();
updateHardyCross();
updateAminas();
updateSepAPI();
updateCatodica();
updateOrificio();
updatePurgadores();
updateH2Tubulacao();
updateIncendio();
updateHRSG();
updateColunaBinaria();
updateAminaKremser();
updateBlowdown();
updateSiloJenike();
updateBoiloff();
updateColunaRecheio();
updateCO2CCS();
updateFluido();
updateComp();
updateBif();
updateEsp();
updateCv();
updatePsv();
updateNpsh();
updateAfin();
updateEcon();
updateVaso();
updateTroca();
updateColuna();
updateComprr();
updateOrif();
updateVapor();
updateAgua();
updateForno();
updateTanque();
updateFlare();
updateTermVao();
updateTermExpansao();
updateTermIsolamento();
updateFiltro();
updateMaterial();
updateVpl();
updateVentosas();
updateTransientes();
renderDashboard();
