/* Additive registry: a candidate record never enables an algorithm. */
(function(root){
'use strict';
const engine=typeof module!=='undefined'&&module.exports?require('./clinical-engine.js'):root.OslerClinicalEngine;
const entries=[{...engine.catalog,status:'synthetic-calculator',sourceVerification:'formula-abstract-verified',
 technicalBounds:'18–120 anos, 1–500 kg, 0.1–30 mg/dL são limites técnicos, não domínio de validação clínica.'},
 {id:'sofa',version:'1996-candidate.1',category:'organ-dysfunction',status:'specification-pending',
 source:'https://pubmed.ncbi.nlm.nih.gov/8844239/',sourceVerification:'bibliography-verified',verified:'2026-11-02',
 purpose:'Descrever disfunção orgânica; não é probabilidade de mortalidade.',population:'Adultos críticos; critérios completos por revisar.',
 inputs:{pao2:'mmHg',fio2:'fraction',platelets:'10^9/L',bilirubin:'mg/dL',map:'mmHg',vasoactives:'ug/kg/min',gcs:'points',creatinine:'mg/dL',urine:'mL/24h'},
 exclusions:['Sedação e suporte precisam de representação explícita; não imputar normal'],window:'Janela e extremos de 24 h exigem cobertura completa e protocolo versionado.'},
 {id:'saps3',version:'2005-candidate.1',category:'prognostic',status:'specification-pending',
 source:'https://pubmed.ncbi.nlm.nih.gov/16132892/',sourceVerification:'bibliography-and-outcome-verified',verified:'2026-11-02',
 purpose:'Modelo de mortalidade hospitalar na admissão à UTI; nenhum modelo probabilístico habilitado.',population:'Coorte adulta de admissão à UTI; transporte/localidade requer validação.',
 inputs:{admission:'timestamp explícito da UTI',physiology:'unidades por variável a revisar',history:'categorias da publicação'},
 exclusions:['Não inferir admissão à UTI pelo início do episódio','Não converter pontos locais em risco'],window:'Admissão; operacionalização e tabela completas ainda por verificar.'},
 {id:'qsofa',version:'2016-candidate.1',category:'prognostic-screen',status:'not-enabled-for-icu',
 source:'https://pmc.ncbi.nlm.nih.gov/articles/PMC4968574/',sourceVerification:'criteria-and-setting-verified',verified:'2026-11-02',
 purpose:'Sinalizar risco de desfechos desfavoráveis em adultos com suspeita de infecção fora da UTI; não diagnostica sepse.',population:'Adultos fora da UTI com suspeita de infecção.',
 inputs:{respiratoryRate:'/min',sbp:'mmHg',alteredMentation:'avaliação clínica explícita'},
 exclusions:['Uso como prognóstico validado na UTI','Uso isolado para excluir sepse'],window:'Avaliação clínica; sem probabilidade individual ou horizonte arbitrário.'},
 {id:'rass',version:'2002-candidate.1',category:'clinical-assessment',status:'specification-pending',
 source:'https://pubmed.ncbi.nlm.nih.gov/12421743/',sourceVerification:'bibliography-and-population-verified',verified:'2026-11-02',
 purpose:'Avaliar agitação/sedação; não inferir de áudio ou texto livre.',population:'Adultos em UTI.',
 inputs:{examination:'respostas observadas à voz/estímulo, protocolo completo por revisar'},
 exclusions:['Avaliação ausente não equivale a alerta/calmo'],window:'Exame atual; repetição gera nova avaliação.'},
 {id:'kdigo-aki',version:'2012-candidate.1',category:'diagnostic-support',status:'specification-pending',
 source:'https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf',sourceVerification:'guideline-criteria-located',verified:'2026-11-02',
 purpose:'Apoiar definição/estadiamento de lesão renal aguda; não indicar terapia automaticamente.',population:'População e critérios etários da diretriz exigem seleção explícita.',
 inputs:{creatinine:'mg/dL, basal e seriada',urine:'mL/kg/h com intervalo',rrt:'início explícito'},
 exclusions:['Basal desconhecida não deve ser inventada','Cobertura incompleta da diurese'],window:'48 h/7 dias e duração da oligúria; sem motor temporal implementado.'}];
function freeze(value){Object.values(value).forEach(v=>{if(v&&typeof v==='object')freeze(v);});return Object.freeze(value);}
const api=freeze({schemaVersion:1,version:'1.0.0',entries});
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OslerClinicalCatalog=api;
})(typeof globalThis!=='undefined'?globalThis:this);
