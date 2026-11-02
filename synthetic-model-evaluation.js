/* Offline evaluation of supplied synthetic probabilities only. Never fits/loads a model. */
'use strict';
const instant=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
function evaluate({syntheticOnly,outcome,horizonHours,modelVersion,asOf,records,bins=10}={}){
 if(syntheticOnly!==true||typeof outcome!=='string'||!outcome.trim()||typeof modelVersion!=='string'||!modelVersion.trim()||!Number.isFinite(horizonHours)||horizonHours<=0||horizonHours>24*366||!instant(asOf)||!Number.isInteger(bins)||bins<1||bins>100||!Array.isArray(records)||!records.length||records.length>100000)throw Error('Explicit synthetic evaluation scope required');
 const ids=new Set(),subjects=new Set(),groups=Array.from({length:bins},()=>({count:0,probabilitySum:0,outcomeSum:0}));
 let error=0,probabilitySum=0,outcomeSum=0;
 for(const row of records){
  if(typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.syntheticSubjectId!=='string'||!row.syntheticSubjectId||subjects.has(row.syntheticSubjectId)||!Number.isFinite(row.probability)||row.probability<0||row.probability>1||![0,1].includes(row.observed)||!instant(row.predictedAt)||!instant(row.followupThrough))throw Error('Invalid/duplicate or censored synthetic record');
  const start=Date.parse(row.predictedAt),end=start+horizonHours*3600000;
  if(Date.parse(row.followupThrough)<end||Date.parse(row.followupThrough)>Date.parse(asOf)||start>Date.parse(asOf)||
   (row.observed===1&&(!instant(row.eventAt)||Date.parse(row.eventAt)<start||Date.parse(row.eventAt)>end))||
   (row.observed===0&&row.eventAt!==undefined))throw Error('Outcome horizon/followup mismatch');
  ids.add(row.id);subjects.add(row.syntheticSubjectId);
  const bin=groups[Math.min(bins-1,Math.floor(row.probability*bins))];bin.count++;bin.probabilitySum+=row.probability;bin.outcomeSum+=row.observed;
  error+=(row.probability-row.observed)**2;probabilitySum+=row.probability;outcomeSum+=row.observed;
 }
 const reliability=groups.map((g,index)=>({index,lower:index/bins,upper:(index+1)/bins,count:g.count,
  meanPrediction:g.count?g.probabilitySum/g.count:null,observedFraction:g.count?g.outcomeSum/g.count:null}));
 return {schemaVersion:1,metricsVersion:'1.0.0',scope:'synthetic-only',modelVersion,outcome,horizonHours,asOf,n:records.length,
  brier:error/records.length,meanPrediction:probabilitySum/records.length,observedFraction:outcomeSum/records.length,
  expectedCalibrationError:reliability.reduce((sum,b)=>sum+(b.count?b.count*Math.abs(b.meanPrediction-b.observedFraction):0),0)/records.length,
  reliability,calibrationSlope:null,calibrationIntercept:null,clinicalRelease:'blocked',
  limitations:'Diagnostics on supplied synthetic values only. Brier is not calibration alone; bins depend on sample/partition. No fitting, uncertainty estimation, discrimination, clinical/external validation or deployment authorization.'};
}
function validateSplit({kind,training,validation}={}){
 if(!['temporal','external'].includes(kind)||!Array.isArray(training)||!training.length||!Array.isArray(validation)||!validation.length)throw Error('Split specification required');
 const trainIds=new Set(),trainSubjects=new Set(),trainSites=new Set();let last=-Infinity,first=Infinity;
 for(const [rows,isTrain] of [[training,true],[validation,false]])for(const row of rows){
  if(!row.id||!row.syntheticSubjectId||!row.site||!instant(row.at))throw Error('Synthetic split identity/time/site required');
  if(isTrain){if(trainIds.has(row.id))throw Error('Duplicate training record');trainIds.add(row.id);trainSubjects.add(row.syntheticSubjectId);trainSites.add(row.site);last=Math.max(last,Date.parse(row.at));}
  else {if(trainIds.has(row.id)||trainSubjects.has(row.syntheticSubjectId))throw Error('Record/subject leakage');first=Math.min(first,Date.parse(row.at));if(kind==='external'&&trainSites.has(row.site))throw Error('External site overlap');}
 }
 if(new Set(validation.map(r=>r.id)).size!==validation.length)throw Error('Duplicate validation record');
 if(kind==='temporal'&&first<=last)throw Error('Temporal overlap');
 return {scope:'synthetic-only',kind,structuralChecks:'passed',clinicalValidation:'not-performed'};
}
module.exports={evaluate,validateSplit};
