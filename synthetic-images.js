/* Deterministic synthetic fixtures generated locally, never clinical documents. */
(function(root){'use strict';
const types=['laboratory','monitor','rotated','low-quality','different-units','missing'];
async function create(type='laboratory',format='image/png'){
 if(!types.includes(type)||!['image/png','image/jpeg','image/webp'].includes(format))throw Error('Unknown synthetic fixture');
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=550;const c=canvas.getContext('2d');
 c.fillStyle=type==='monitor'?'#111':'white';c.fillRect(0,0,1200,550);c.fillStyle=type==='monitor'?'#fff':'black';
 c.font='bold 42px Arial';c.fillText('OSLER - DOCUMENTO SINTETICO',35,65);c.font='40px Arial';
 const lines=type==='different-units'?['Creatinina: 88.4 umol/L','Peso: 72000 g']:type==='missing'?['Peso: 72','Creatinina: sem resultado','Documento sem horario']:type==='monitor'?['FC: 80 bpm','PAS: 120 mmHg','SpO2: 98 %']:['Peso: 72 kg','Creatinina: 1.00 mg/dL','pH: 7.40'];
 lines.forEach((line,i)=>c.fillText(line,35,145+i*80));c.font='24px Arial';c.fillText('Sem identificacao de paciente. Horarios nao informados.',35,490);
 let output=canvas;
 if(type==='low-quality'){const small=document.createElement('canvas');small.width=480;small.height=220;small.getContext('2d').drawImage(canvas,0,0,480,220);c.filter='blur(0.55px)';c.drawImage(small,0,0,1200,550);c.filter='none';let seed=17;for(let i=0;i<3000;i++){seed=(seed*1664525+1013904223)>>>0;c.fillStyle='rgba(100,100,100,0.13)';c.fillRect(seed%1200,(seed>>>12)%550,2,2);}}
 if(type==='rotated'){output=document.createElement('canvas');output.width=550;output.height=1200;const r=output.getContext('2d');r.translate(550,0);r.rotate(Math.PI/2);r.drawImage(canvas,0,0);}
 const blob=await new Promise(resolve=>output.toBlob(resolve,format,0.82));if(!blob)throw Error('Image encoding unavailable');
 return {blob,lines,type,format};
}
root.OslerSyntheticImages={types,create};
})(globalThis);
