const fs = require('fs');
const path = require('path');
const t = fs.readFileSync(String.raw`C:\Users\apach\AppData\Local\Temp\claude\E--Samsung-Downloads-Books-Tabletop-EMBER-Obsidian-Protocol\97f5c0b7-47d1-4b45-85b8-b72f142f38bd\scratchpad\builder_bundle.js`, 'utf8');
const OUTDIR = String.raw`E:\ClaudeProjects\Ember Obsidian Protocol\TestingGrounds\data`;

function extractBalanced(text, start) {
  let depth = 0, i = start, inStr = null;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === inStr) inStr = null;
    } else {
      if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    i++;
  }
  throw new Error('unbalanced');
}
const HELPERS = `
const ox=(t,e,n)=>({id:t,type:"building",subCells:Array.from({length:9},(r,i)=>({col:e+i%3,row:n+Math.floor(i/3)})),height:3,blocksLos:!0,providesProtection:!0,isFragile:!1});
const gd=(t,e,n,r,i)=>({id:t,type:e,subCells:Array.from({length:3},(o,s)=>({col:n+(i==="horizontal"?s:0),row:r+(i==="vertical"?s:0)})),height:e==="high_wall"?3:2,blocksLos:e==="high_wall",providesProtection:!0,isFragile:!1});
const Xh=(t,e,n,r)=>({id:t,type:"container",subCells:Array.from({length:r==="single"?1:2},(i,o)=>({col:e+(r==="horizontal"?o:0),row:n+(r==="vertical"?o:0)})),height:1,blocksLos:!1,providesProtection:!1,isFragile:!0});
`;
function grabArray(varName) {
  const m = t.match(new RegExp(`[^\\w.$]${varName}=\\[`));
  if (!m) return null;
  return new Function(HELPERS + 'return ' + extractBalanced(t, m.index + m[0].length - 1))();
}

const maps = grabArray('rf');
const assoc = { alley: 'lit', crossroads: 'cit', hotspot: 'dit' };
const out = { maps: [], layouts: {} };
for (const mp of maps) {
  const varName = assoc[mp.id];
  if (!varName) continue;
  const arr = grabArray(varName);
  if (!arr) { console.log('MISSING layout for', mp.id, varName); continue; }
  out.maps.push(mp);
  out.layouts[mp.id] = arr;
  console.log('layout', mp.id, 'pieces:', arr.length, 'types:', [...new Set(arr.map(x => x.type))].join(','));
}

fs.writeFileSync(path.join(OUTDIR, 'terrain_layouts.json'), JSON.stringify(out, null, 1), 'utf8');
console.log('written');
