/* Osler: independent, conservative checks on clinician-reviewed measurements.
   No automatic clinical decisions. Unknown is not normal. */
(function(root){
'use strict';
const rules={
  ph:{min:6.5,max:8.2,unit:''},pao2:{min:15,max:700,unit:'mmHg'},
  paco2:{min:10,max:150,unit:'mmHg'},fio2:{min:0.21,max:1,unit:'fraction'},
  peep:{min:0,max:35,unit:'cmH2O'},spo2:{min:40,max:100,unit:'%'},
  heartRate:{min:20,max:250,unit:'bpm'},temperature:{min:25,max:43,unit:'°C'},
  sbp:{min:40,max:300,unit:'mmHg'},map:{min:20,max:200,unit:'mmHg'},
  sodium:{min:90,max:200,unit:'mmol/L'},potassium:{min:1,max:10,unit:'mmol/L'},
  creatinine:{min:0.1,max:30,unit:'mg/dL'},weight:{min:1,max:500,unit:'kg'},
  tidalVolume:{min:50,max:2000,unit:'mL'},respiratoryRate:{min:1,max:80,unit:'rpm'}
};
const near=(a,b,tol)=>Math.abs(a-b)<=tol;
function validate(observations){
  const issues=[],accepted={};
  for(const [key,raw] of Object.entries(observations||{})){
    if(!raw || raw.confirmed!==true){issues.push({key,code:'unconfirmed',message:'Dado não confirmado pelo profissional'});continue;}
    if(raw.bed && !/^\d{2}$/.test(raw.bed)){issues.push({key,code:'bed',message:'Identificador de leito inválido'});continue;}
    if(!raw.timestamp || !Number.isFinite(Date.parse(raw.timestamp))){issues.push({key,code:'timestamp',message:'Horário de aferição ausente ou inválido'});continue;}
    if(Date.parse(raw.timestamp)>Date.now()+5*60*1000){issues.push({key,code:'future',message:'Horário posterior ao atual'});continue;}
    const rule=rules[key];
    if(!rule){issues.push({key,code:'unknown',message:'Variável sem regra de validação'});continue;}
    const value=raw.value;
    if(typeof value!=='number'||!Number.isFinite(value)||value<rule.min||value>rule.max){
      issues.push({key,code:'range',message:'Valor inválido ou fora da faixa de plausibilidade; verificar unidade e origem'});continue;
    }
    if(raw.unit!==rule.unit){issues.push({key,code:'unit',message:'Unidade incompatível; conversão explícita necessária'});continue;}
    accepted[key]=raw;
  }
  const val=k=>accepted[k]?.value;
  if(val('map')!=null&&val('sbp')!=null&&val('map')>val('sbp')){
    issues.push({key:'map',code:'inconsistent',message:'PAM maior que PAS; conferir medidas e horários'});
    delete accepted.map;
  }
  if(val('fio2')!=null&&val('pao2')!=null){
    const ratio=val('pao2')/val('fio2');
    if(!Number.isFinite(ratio)||ratio<=0)issues.push({key:'pao2',code:'derived',message:'Relação PaO₂/FiO₂ inválida'});
  }
  return {accepted,issues,reviewRequired:issues.length>0};
}
function checkFluidBalance(intake,output,balance){
  if(![intake,output,balance].every(x=>typeof x==='number'&&Number.isFinite(x)))
    return {valid:false,reason:'Dados incompletos ou não numéricos'};
  if(intake<0||output<0)return {valid:false,reason:'Entradas e saídas devem ser não negativas'};
  return {valid:near(intake-output,balance,1),computed:intake-output,reason:near(intake-output,balance,1)?'Conferência aritmética aprovada':'Saldo incompatível com entradas menos saídas'};
}
const api={validate,checkFluidBalance,rules};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.OslerValidation=api;
})(typeof window!=='undefined'?window:globalThis);
