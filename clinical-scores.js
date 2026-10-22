/* Deterministic, auditable extraction. No diagnostic inference or treatment decisions.
   SAPS 3: Moreno et al., Intensive Care Med. 2005;31:1345–1355, tables 1–2.
   SOFA: Vincent et al., Intensive Care Med. 1996;22:707–710 (original SOFA).
   HAS-BLED: Pisters et al., Chest. 2010;138:1093–1100.
   CHA2DS2-VASc: Lip et al., Chest. 2010;137:263–272.
   Cockcroft–Gault: Nephron. 1976;16:31–41. */
(function (root) {
  'use strict';
  const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[₂₃⁹³]/g, c => ({'₂':'2','₃':'3','⁹':'9','³':'3'}[c])).replace(/[µμ]/g, 'u').replace(/\s+/g, ' ').trim();
  const fields = [];
  function numeric(key, label, aliases, min, max, unit = '', kind = '', integer = false) {
    fields.push({ key, label, aliases, min, max, unit, kind, integer, type: 'number' });
  }
  function choice(key, label, aliases, options, type = 'select') { fields.push({ key, label, aliases, options, type }); }
  function bool(key, label, aliases) { choice(key, label, aliases, {true:'Sim', false:'Não'}, 'boolean'); }
  numeric('age','Idade',['idade'],18,120,'anos','',true);
  numeric('weight','Peso para Cockcroft–Gault',['peso','peso corporal'],1,500,'kg','weight');
  choice('sex','Sexo para a fórmula',['sexo','sexo biologico'],{male:'Masculino',female:'Feminino'});
  numeric('creatinine','Creatinina',['creatinina','creatinina serica','cr'],0.1,40,'mg/dL','creatinine');
  numeric('platelets','Plaquetas',['plaquetas','plaq'],0,3000,'10⁹/L','count');
  numeric('bilirubin','Bilirrubina total',['bilirrubina total','bilirrubina','bt'],0,100,'mg/dL','bilirubin');
  numeric('temperature','Temperatura',['temperatura','temperatura corporal','temp'],20,45,'°C','temperature');
  numeric('heartRate','Frequência cardíaca',['fc','frequencia cardiaca'],1,350,'bpm');
  numeric('leukocytes','Leucócitos',['leucocitos','leuco'],0,1000,'10⁹/L','count');
  numeric('ph','pH arterial',['ph','ph arterial'],6,8.5);
  numeric('sbp','Pressão sistólica',['pas','pressao sistolica','pressao arterial sistolica'],1,350,'mmHg','pressure');
  numeric('map','Pressão arterial média',['pam','pressao arterial media'],1,250,'mmHg','pressure');
  numeric('pao2','PaO₂ arterial',['pao2'],1,800,'mmHg','pressure');
  numeric('fio2','FiO₂',['fio2'],0.21,1,'fração','fio2');
  numeric('pf','PaO₂/FiO₂',['pao2/fio2','p/f','relacao pf'],1,2000);
  numeric('gcs','Glasgow estimado sem sedação',['glasgow','gcs','glasgow sem sedacao'],3,15,'pontos','',true);
  numeric('urine','Diurese em 24 horas',['diurese 24h','diurese em 24h','diurese de 24h'],0,30000,'mL/24h','urine');
  bool('ventilation','Ventilação mecânica (SAPS 3)',['ventilacao mecanica','vm']);
  bool('respiratorySupport','Suporte respiratório (SOFA)',['suporte respiratorio']);
  bool('noVasoactives','Sem drogas vasoativas atuais',['sem drogas vasoativas','sem dva','sem vasopressores']);
  for (const [key,label,aliases] of [['norepinephrine','Noradrenalina',['noradrenalina','norepinefrina']],['epinephrine','Adrenalina',['adrenalina','epinefrina']],['dopamine','Dopamina',['dopamina']],['dobutamine','Dobutamina',['dobutamina']]]) {
    numeric(key,label,aliases,0,100,'µg/kg/min','dose');
  }
  bool('hypertension','Hipertensão arterial prévia (CHA₂DS₂-VASc)',['hipertensao arterial','hipertensao','has']);
  bool('heartFailure','Insuficiência cardíaca/disfunção ventricular',['insuficiencia cardiaca','ic','disfuncao ventricular']);
  bool('diabetes','Diabetes mellitus',['diabetes mellitus','diabetes','dm','dm2']);
  bool('stroke','AVC prévio (HAS-BLED)',['avc previo','avc','acidente vascular cerebral']);
  bool('strokeTIA','AVC/AIT/tromboembolismo prévio (CHA₂DS₂-VASc)',['avc/ait/embolia','avc/ait','avc ait','avc ait embolia','avc ait ou embolia']);
  bool('vascular','Doença vascular (IAM, DAP, placa aórtica)',['doenca vascular','iam/dap/placa aortica']);
  bool('uncontrolledHTN','PAS persistentemente >160 mmHg (HAS-BLED)',['hipertensao nao controlada','hipertensao descontrolada']);
  bool('abnormalRenal','Disfunção renal segundo HAS-BLED',['disfuncao renal has-bled','funcao renal alterada has-bled']);
  bool('dialysis','Diálise crônica',['dialise cronica','hemodialise cronica']);
  bool('renalTransplant','Transplante renal prévio',['transplante renal']);
  bool('abnormalLiver','Disfunção hepática segundo HAS-BLED',['disfuncao hepatica has-bled']);
  numeric('bilirubinULN','Limite superior normal da bilirrubina',['lsn bilirrubina'],0.1,10,'mg/dL','bilirubin');
  for (const enzyme of ['ast','alt','alp']) {
    numeric(enzyme,enzyme.toUpperCase(),[enzyme],0,50000,'U/L','enzyme');
    numeric(enzyme+'ULN','LSN '+enzyme.toUpperCase(),['lsn '+enzyme],1,2000,'U/L','enzyme');
  }
  bool('cirrhosis','Cirrose',['cirrose','cirrose hepatica']);
  bool('bleeding','Sangramento prévio/predisposição',['sangramento previo','predisposicao a sangramento']);
  bool('labileINR','INR lábil / TTR <60%',['inr labil','inr instavel']);
  numeric('ttr','TTR',['ttr'],0,100,'%');
  bool('bleedingDrugs','Antiagregante ou AINE em uso',['antiagregante/aine','antiagregantes ou aines','drogas has-bled']);
  bool('alcohol','Álcool ≥8 doses/semana',['alcool has-bled','alcool >=8 doses/semana','alcool excessivo']);
  bool('acuteKidney','Lesão renal aguda',['lesao renal aguda','ira','lra']);
  numeric('hospitalDays','Dias de internação antes da UTI',['dias antes da uti','dias internacao pre uti'],0,3650,'dias');
  choice('location','Procedência antes da UTI',['procedencia','origem pre uti'],{emergency:'Pronto-socorro',icu:'Outra UTI',ward:'Enfermaria/outro',operating:'Centro cirúrgico/recuperação'});
  bool('vasoactiveBefore','DVA antes da admissão na UTI',['dva antes da uti','vasoativos pre uti']);
  choice('planned','Admissão planejada',['admissao uti','admissao planejada'],{planned:'Planejada',unplanned:'Não planejada'});
  choice('surgery','Estado cirúrgico na admissão',['cirurgia','estado cirurgico'],{elective:'Eletiva',emergency:'Emergência',none:'Sem cirurgia'});
  choice('surgerySite','Tipo de cirurgia',['tipo cirurgia','sitio cirurgico'],{transplant:'Transplante',trauma:'Trauma',cabg:'RM sem reparo valvar',stroke:'Neurocirurgia por AVC',other:'Outro'});
  choice('infection','Aquisição da infecção',['infeccao','aquisicao infeccao'],{none:'Sem infecção',community:'Comunitária',hospital:'Hospitalar'});
  choice('infectionSite','Sítio da infecção',['sitio infeccao','foco infeccioso'],{respiratory:'Respiratório',other:'Outro',none:'Sem infecção'});
  choice('comorbidities','Comorbidades do SAPS 3 (lista completa)',['comorbidades saps 3','comorbidades saps3'],{none:'Nenhuma',therapy:'Terapia antineoplásica/imunossupressora',nyha:'IC NYHA IV',hematologic:'Câncer hematológico',cirrhosis:'Cirrose',aids:'AIDS',metastatic:'Câncer metastático'},'multi');
  choice('reasons','Motivos da admissão (lista completa)',['motivos admissao','motivos da admissao','motivo admissao'],{other:'Outros',arrhythmia:'Arritmia',seizures:'Convulsões',hypovolemic:'Choque hipovolêmico',abdominal:'Abdome agudo/outro digestivo',altered:'Alteração de consciência',septic:'Choque séptico',otherShock:'Choque anafilático/misto/indefinido',liver:'Insuficiência hepática',focal:'Déficit neurológico focal',pancreatitis:'Pancreatite grave',mass:'Efeito de massa intracraniana'},'multi');
  bool('sapsWindow','Dados SAPS 3: extremos de ±1h da admissão',['janela saps 3','janela saps3']);
  bool('sofaWindow','Dados SOFA: piores valores das 24h',['janela sofa']);
  const byKey = Object.fromEntries(fields.map(f => [f.key,f]));
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  function parseNumber(s) {
    let text=s.trim().replace(/\s/g,'');
    if (text.includes(',')) text=text.replace(/\./g,'').replace(',','.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text=text.replace(/\./g,'');
    return Number(text);
  }
  function convert(value, suffix, f) {
    const u=normalize(suffix).replace(/\s/g,'');
    if (f.kind === 'creatinine' || f.kind === 'bilirubin') {
      if (/^(umol\/l)/.test(u)) return value/(f.kind==='creatinine'?88.4:17.1);
      if (!/^mg\/?dl/.test(u)) throw Error('Informe mg/dL ou µmol/L.');
    }
    if (f.kind==='count') {
      if (/^(\/mm3|\/ul|celulas\/mm3|celulas\/ul)/.test(u)) return value/1000;
      if (/^(mil|10\^?9\/l|x10\^?9\/l|g\/l)/.test(u)) return value;
      throw Error('Informe /mm3, /µL ou 10^9/L.');
    }
    if (f.kind==='enzyme' && !/^u\/l$/.test(u)) throw Error('Informe U/L.');
    if (f.kind==='fio2') {
      if (u.startsWith('%')) return value/100;
      if (value>1) throw Error('FiO₂ acima de 1 exige o símbolo %.');
    }
    if (f.kind==='urine') {
      if (/^l(?:\/24h|\b)/.test(u)) return value*1000;
      if (!/^ml(?:\/24h|\b)/.test(u)) throw Error('Informe mL/24h.');
    }
    if (f.kind==='pressure') {
      if (u.startsWith('kpa')) return value*7.50062;
      if (u && !u.startsWith('mmhg')) throw Error('Use mmHg ou kPa.');
    }
    if (f.kind==='dose' && !/^(?:ug|mcg)\/kg\/min/.test(u)) throw Error('Informe µg/kg/min; mL/h não permite calcular a dose.');
    if (f.kind==='weight' && u && !u.startsWith('kg')) throw Error('Informe peso em kg.');
    if (f.kind==='temperature' && u && !/^(?:°?c|graus)/.test(u)) throw Error('Informe temperatura em °C.');
    return value;
  }
  const words = {
    male:['masculino','homem','m'],female:['feminino','mulher','f'],
    emergency:['pronto-socorro','pronto socorro','emergencia','urgencia','ps'],icu:['outra uti'],ward:['enfermaria','outro','outra'],operating:['centro cirurgico','recuperacao anestesica','sala de recuperacao'],
    planned:['planejada','sim'],unplanned:['nao planejada','nao','nao programada'],elective:['eletiva','programada'],none:['nenhuma','nenhum','sem cirurgia','sem infeccao','nao','ausente'],
    transplant:['transplante'],trauma:['trauma'],cabg:['rm sem reparo valvar','revascularizacao sem reparo valvar'],stroke:['neurocirurgia por avc'],other:['outro','outros','outro digestivo'],
    community:['comunitaria'],hospital:['hospitalar','nosocomial'],respiratory:['respiratorio','pulmonar','pneumonia'],
    therapy:['terapia antineoplasica/imunossupressora','terapia antineoplasica','quimioterapia','imunossupressao','radioterapia','corticoterapia'],nyha:['ic nyha iv','nyha iv'],hematologic:['cancer hematologico','neoplasia hematologica'],cirrhosis:['cirrose'],aids:['aids'],metastatic:['cancer metastatico','neoplasia metastatica'],
    arrhythmia:['arritmia'],seizures:['convulsoes','convulsao'],hypovolemic:['choque hipovolemico'],abdominal:['abdome agudo','abdome agudo/outro digestivo'],altered:['alteracao de consciencia','coma','delirium'],septic:['choque septico'],otherShock:['choque anafilatico','choque misto','choque indefinido'],liver:['insuficiencia hepatica'],focal:['deficit neurologico focal'],pancreatitis:['pancreatite grave'],mass:['efeito de massa intracraniana']
  };
  function selectValue(text, f) {
    const value=normalize(text).replace(/[.!]$/,'').trim();
    if (f.type==='boolean') {
      if (/^(sim|presente|positivo|em uso)$/.test(value)) return true;
      if (/^(nao|ausente|negativo|nenhum|nenhuma|sem uso)$/.test(value)) return false;
      if (f.key==='sapsWindow' && /^(admissao|admissao [±+-] ?1h|extremos da admissao)$/.test(value)) return true;
      if (f.key==='sofaWindow' && /^(piores 24h|piores valores 24h|piores valores das 24h)$/.test(value)) return true;
      throw Error('Informe sim ou não explicitamente.');
    }
    const values = f.type==='multi' ? value.split(/\s*[,|+]\s*/) : [value];
    const selected=values.map(token => {
      const key=Object.keys(f.options).find(k => normalize(k)===token || normalize(f.options[k])===token || (words[k]||[]).includes(token));
      if (!key) throw Error('Valor não reconhecido; selecione uma opção para revisar.');
      return key;
    });
    if (selected.includes('none') && selected.length>1) throw Error('“Nenhuma” contradiz os outros itens.');
    return f.type==='multi' ? [...new Set(selected)].sort() : selected[0];
  }
  function extract(text) {
    const data={};
    // Semicolons, newlines and sentence endings delimit observations. Decimal points are preserved.
    const baseClauses=String(text).split(/[;\n]+|(?<=[a-zA-Z)])\.\s+/).map(x=>x.trim()).filter(Boolean);
    const clauses=[];
    for (const original of baseClauses) {
      const line=normalize(original);
      const starts=new Set([0]);
      for (const f of fields) {
        const next=f.type==='number'?'(?=[-+]?\\d)':f.type==='boolean'?'(?=(?:sim|nao|presente|ausente|positivo|negativo)\\b)':'(?=\\S)';
        const separator=f.type==='select'||f.type==='multi'?'\\s*[:=]\\s*':'(?:\\s*[:=]\\s*|\\s+)';
        const rx=new RegExp('(?:^|[\\s,(])('+f.aliases.sort((a,b)=>b.length-a.length).map(escape).join('|')+')'+separator+next,'g');
        for (const match of line.matchAll(rx)) {
          const position=match.index+(match[0].match(/^[\s,(]/)?1:0);
          // Do not split a longer label such as “LSN bilirrubina” at its inner alias.
          if (/lsn\s*$/.test(line.slice(0,position))) continue;
          starts.add(position);
        }
      }
      const positions=[...starts].sort((a,b)=>a-b);
      positions.forEach((position,i)=>{
        const piece=line.slice(position,positions[i+1]??line.length).replace(/[,() ]+$/,'').trim();
        if(piece) clauses.push(piece);
      });
    }
    for (const f of fields) {
      const candidates=[];
      const aliases=[...f.aliases].sort((a,b)=>b.length-a.length);
      for (const original of clauses) {
        const line=normalize(original);
        const alias=aliases.find(a => new RegExp('^(?:'+escape(a)+')(?:\\s*[:=]\\s*|\\s+|$)').test(line));
        if (!alias) continue;
        const longerLabel=fields.some(other=>other!==f && other.aliases.some(a=>a.length>alias.length && new RegExp('^(?:'+escape(a)+')(?:\\s*[:=]\\s*|\\s+|$)').test(line)));
        if (longerLabel) continue;
        let raw=line.slice(alias.length).replace(/^\s*[:=]\s*|^\s+/,'');
        if (!raw && f.type==='boolean' && f.key==='noVasoactives') raw='sim';
        try {
          let value;
          if (f.type==='number') {
            const match=raw.match(/^([-+]?\d+(?:[.,]\d+)*)(.*)$/);
            if (!match) throw Error('Número não reconhecido.');
            const suffix=match[2].trim();
            // A second observation in the same clause must be split, not silently ignored.
            if (/(?:\s|^)(?:idade|peso|creatinina|plaquetas|pao2|fio2|glasgow|pam|pas|fc)\s*[:=]/.test(suffix)) throw Error('Separe cada informação com ponto e vírgula ou nova linha.');
            value=convert(parseNumber(match[1]),suffix,f);
            if (!Number.isFinite(value) || value<f.min || value>f.max || (f.integer && f.kind!=='count' && !Number.isInteger(value))) throw Error(`Valor fora do intervalo ${f.min}–${f.max} ${f.unit}.`);
          } else value=selectValue(raw,f);
          candidates.push({value,source:original});
        } catch(error) { candidates.push({value:null,source:original,error:error.message}); }
      }
      // Simple, explicitly negated history can be understood without turning an absent diagnosis into “no”.
      if (!candidates.length && f.type==='boolean' && ['hypertension','diabetes','heartFailure','stroke','vascular','cirrhosis','bleeding','dialysis','renalTransplant','acuteKidney'].includes(f.key)) {
        for (const original of clauses) {
          const line=normalize(original);
          for (const alias of aliases) {
            if (new RegExp('^(?:nega|sem|nao tem|nao apresenta) '+escape(alias)+'$').test(line)) candidates.push({value:false,source:original});
            else if (line===alias) candidates.push({value:true,source:original});
          }
        }
      }
      if (!candidates.length) continue;
      const unique=new Set(candidates.filter(c=>!c.error).map(c=>JSON.stringify(c.value)));
      const errors=candidates.filter(c=>c.error);
      if (unique.size>1 || errors.length) data[f.key]={value:null,source:candidates.map(c=>c.source).join(' | '),error:unique.size>1?'Valores conflitantes. Revise o dado e a janela temporal.':errors[0].error};
      else data[f.key]={value:candidates[0].value,source:candidates.map(c=>c.source).join(' | ')};
    }
    // Common prose demographic form: “Paciente de 70 anos”.
    if (!data.age) {
      const matches=[...normalize(text).matchAll(/\b(?:paciente(?: de)?|idade de)\s+(\d{1,3})\s*anos\b/g)];
      if (matches.length) {
        const ages=[...new Set(matches.map(m=>Number(m[1])))];
        data.age=ages.length===1 && ages[0]>=18 && ages[0]<=120 ? {value:ages[0],source:matches[0][0]} : {value:null,error:'Idade conflitante ou fora da faixa adulta.',source:matches.map(m=>m[0]).join(' | ')};
      }
    }
    return data;
  }
  function calculate(data) {
    const val=k=>data[k] && !data[k].error && data[k].value!==null && data[k].value!=='' ? data[k].value : null;
    const present=k=>val(k)!==null;
    const result=(name,parts,unit='pontos',note='')=>{
      const missing=parts.filter(p=>p.points===null).map(p=>p.label);
      const available=parts.filter(p=>p.points!==null);
      return {name,complete:missing.length===0,value:missing.length?null:available.reduce((n,p)=>n+p.points,0),subtotal:available.reduce((n,p)=>n+p.points,0),parts,missing,unit,note};
    };
    const part=(label,keys,fn)=>({label,points:keys.every(present)?fn(...keys.map(val)):null});
    const age=val('age');
    const cgMissing=['age','weight','sex','creatinine'].filter(k=>!present(k));
    if (val('acuteKidney')===true) cgMissing.push('acuteKidney');
    const crcl={name:'ClCr · Cockcroft–Gault',complete:!cgMissing.length,value:cgMissing.length?null:(140-age)*val('weight')/(72*val('creatinine'))*(val('sex')==='female'?0.85:1),unit:'mL/min',missing:cgMissing.map(k=>k==='acuteKidney'?'Função renal estável: fórmula inadequada em LRA':byKey[k].label),parts:[],note:'Estimativa não indexada à superfície corporal; depende do peso apropriado e de creatinina estável. Não equivale à eTFG CKD-EPI.'};
    const renalPositive=val('dialysis')===true || val('renalTransplant')===true || (present('creatinine') && val('creatinine')>200/88.4);
    const renal=val('abnormalRenal')===false && renalPositive ? null : val('abnormalRenal') ?? (renalPositive ? true : (val('dialysis')===false && val('renalTransplant')===false && present('creatinine') ? false : null));
    const highBili=present('bilirubin') && present('bilirubinULN') ? val('bilirubin')>2*val('bilirubinULN') : null;
    const highEnzymes=['ast','alt','alp'].map(k=>present(k)&&present(k+'ULN')?val(k)>3*val(k+'ULN'):null);
    const hepaticLabs=highBili===true && highEnzymes.some(v=>v===true) ? true : highBili===false || (highBili===true && highEnzymes.every(v=>v===false)) ? false : null;
    const liverPositive=val('cirrhosis')===true || hepaticLabs===true;
    const liver=val('abnormalLiver')===false && liverPositive ? null : val('abnormalLiver') ?? (liverPositive ? true : val('cirrhosis')===false && hepaticLabs===false ? false : null);
    const htn=val('uncontrolledHTN');
    const labile=present('labileINR') && present('ttr') && val('labileINR')!==(val('ttr')<60) ? null : val('labileINR') ?? (present('ttr') ? val('ttr')<60 : null);
    const hasbled=result('HAS-BLED',[
      {label:'Hipertensão não controlada (PAS persistente >160)',points:htn===null?null:Number(htn)},
      {label:'Disfunção renal (diálise, transplante ou creatinina >200 µmol/L)',points:renal===null?null:Number(renal)},
      {label:'Disfunção hepática (cirrose ou critérios laboratoriais HAS-BLED)',points:liver===null?null:Number(liver)},
      part('AVC prévio',['stroke'],v=>Number(v)),part('Sangramento/predisposição',['bleeding'],v=>Number(v)),
      {label:'INR lábil / TTR <60%',points:labile===null?null:Number(labile)},
      part('Idade >65 anos',['age'],v=>Number(v>65)),part('Antiagregante/AINE',['bleedingDrugs'],v=>Number(v)),part('Álcool ≥8 doses/semana',['alcohol'],v=>Number(v))
    ],'pontos','Ausência de informação não significa ausência de risco. INR isolado não determina estabilidade do INR. O escore não decide anticoagulação.');
    const strokeTIA=val('strokeTIA')===false && val('stroke')===true ? null : val('strokeTIA') ?? (val('stroke')===true?true:null);
    const chads=result('CHA₂DS₂-VASc',[
      part('Insuficiência cardíaca/disfunção ventricular',['heartFailure'],v=>Number(v)),part('Hipertensão arterial',['hypertension'],v=>Number(v)),
      part('Idade (65–74: 1; ≥75: 2)',['age'],v=>v>=75?2:v>=65?1:0),part('Diabetes',['diabetes'],v=>Number(v)),
      {label:'AVC/AIT/tromboembolismo prévios',points:strokeTIA===null?null:(strokeTIA?2:0)},part('Doença vascular',['vascular'],v=>Number(v)),part('Sexo feminino',['sex'],v=>Number(v==='female'))
    ],'pontos','Aplicável ao contexto de fibrilação atrial. Sexo feminino é modificador de risco; o resultado não é uma prescrição.');
    const derivedRatio=present('pao2') && present('fio2') ? val('pao2')/val('fio2') : null;
    const ratioConflict=present('pf') && derivedRatio!==null && Math.abs(val('pf')-derivedRatio)>Math.max(1,derivedRatio*.02);
    const ratio=ratioConflict?null:val('pf') ?? derivedRatio;
    const support=val('respiratorySupport') ?? (val('ventilation')===true?true:null);
    let resp=ratio===null?null:ratio>=400?0:ratio>=300?1:ratio>=200?2:support===null?null:support===false?2:ratio>=100?3:4;
    const pressors=['norepinephrine','epinephrine','dopamine','dobutamine'];
    const doses=pressors.map(k=>val(k) ?? (val('noVasoactives')===true?0:null));
    const contradiction=val('noVasoactives')===true && pressors.some(k=>present(k)&&val(k)>0);
    let cardio=null;
    if (!contradiction) {
      const [nor,epi,dop,dob]=doses;
      if ((nor!==null&&nor>0.1)||(epi!==null&&epi>0.1)||(dop!==null&&dop>15)) cardio=4;
      else if (doses.every(v=>v!==null)) cardio=(nor>0||epi>0||dop>5)?3:(dop>0||dob>0)?2:present('map')?(val('map')<70?1:0):null;
    }
    const cr=val('creatinine'), urine=val('urine');
    const renalCr=cr===null?null:cr<1.2?0:cr<2?1:cr<3.5?2:cr<5?3:4;
    const renalUrine=urine===null?null:urine<200?4:urine<500?3:0;
    const renalSOFA=renalCr===4||renalUrine===4?4:renalCr!==null&&renalUrine!==null?Math.max(renalCr,renalUrine):null;
    const sofa=result('SOFA (original)',[
      {label:ratioConflict?'Respiração: PaO₂/FiO₂ informado contradiz PaO₂ e FiO₂':'Respiração: PaO₂/FiO₂ e suporte',points:resp},part('Coagulação: plaquetas',['platelets'],v=>v>=150?0:v>=100?1:v>=50?2:v>=20?3:4),
      part('Fígado: bilirrubina',['bilirubin'],v=>v<1.2?0:v<2?1:v<6?2:v<12?3:4),
      {label:contradiction?'Cardiovascular: DVA contraditórias':'Cardiovascular: PAM e doses de todas as DVA',points:cardio},
      part('Neurológico: Glasgow sem sedação',['gcs'],v=>v===15?0:v>=13?1:v>=10?2:v>=6?3:4),
      {label:'Renal: creatinina e diurese/24h (pior componente)',points:renalSOFA},
      {label:'Janela SOFA: piores valores das 24h',points:val('sofaWindow')===true?0:null}
    ],'pontos','SOFA original, 0–24. DVA em µg/kg/min. Avalie Glasgow sem efeito de sedação e use o pior valor do período.');
    const comorb=val('comorbidities');
    const reasons=val('reasons');
    const comorbPoints={therapy:3,nyha:6,hematologic:6,cirrhosis:8,aids:8,metastatic:11,none:0};
    const reasonPoints={hypovolemic:3,abdominal:3,altered:4,septic:5,otherShock:5,liver:6,focal:7,pancreatitis:9,mass:10,other:0};
    let reasonTotal=null;
    if (reasons!==null) reasonTotal=reasons.reduce((n,k)=>n+(reasonPoints[k]||0),0)+(reasons.includes('seizures')?-4:reasons.includes('arrhythmia')?-5:0);
    const surgerySite=val('surgery')==='none'?0:present('surgerySite')?({transplant:-11,trauma:-8,cabg:-6,stroke:5,other:0}[val('surgerySite')]):null;
    let oxygen=null;
    if (val('ventilation')===true && ratio!==null) oxygen=ratio<100?11:7;
    if (val('ventilation')===false && present('pao2')) oxygen=val('pao2')<60?5:0;
    const saps=result('SAPS 3',[
      {label:'Constante de admissão',points:16},part('Idade',['age'],v=>v<40?0:v<60?5:v<70?9:v<75?13:v<80?15:18),
      {label:'Comorbidades SAPS 3 (lista completa)',points:comorb===null?null:comorb.reduce((n,k)=>n+comorbPoints[k],0)},
      part('Internação antes da UTI',['hospitalDays'],v=>v<14?0:v<28?6:7),part('Procedência',['location'],v=>({emergency:5,icu:7,ward:8,operating:0}[v])),
      part('DVA antes da admissão',['vasoactiveBefore'],v=>v?3:0),part('Admissão planejada',['planned'],v=>v==='unplanned'?3:0),
      {label:'Motivos da admissão (lista completa)',points:reasonTotal},part('Estado cirúrgico',['surgery'],v=>({elective:0,none:5,emergency:6}[v])),
      {label:'Tipo de cirurgia',points:surgerySite},part('Aquisição da infecção',['infection'],v=>v==='hospital'?4:0),
      {label:'Sítio da infecção',points:val('infection')==='none' && present('infectionSite') && val('infectionSite')!=='none'?null:val('infection')==='none'?0:present('infectionSite')?(val('infectionSite')==='respiratory'?5:0):null},
      part('Glasgow',['gcs'],v=>v<=4?15:v===5?10:v===6?7:v<=12?2:0),part('Bilirrubina',['bilirubin'],v=>v<2?0:v<6?4:5),
      part('Temperatura',['temperature'],v=>v<35?7:0),part('Creatinina',['creatinine'],v=>v<1.2?0:v<2?2:v<3.5?7:8),
      part('Frequência cardíaca',['heartRate'],v=>v<120?0:v<160?5:7),part('Leucócitos',['leukocytes'],v=>v<15?0:2),
      part('pH',['ph'],v=>v<=7.25?3:0),part('Plaquetas',['platelets'],v=>v<20?13:v<50?8:v<100?5:0),
      part('Pressão sistólica',['sbp'],v=>v<40?11:v<70?8:v<120?3:0),{label:'Oxigenação e ventilação mecânica',points:oxygen},
      {label:'Janela SAPS 3: extremos de ±1h da admissão',points:val('sapsWindow')===true?0:null}
    ],'pontos','SAPS 3 de admissão. Pontos dos blocos I–III, sem estimativa de mortalidade ou calibração regional. Não usa os piores valores de 24h.');
    return {saps,sofa,hasbled,crcl,chads};
  }
  const api={fields,extract,calculate,normalize,parseNumber};
  if (typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.ClinicalScores=api;
})(typeof window!=='undefined'?window:globalThis);
