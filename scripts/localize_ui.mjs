import fs from 'node:fs';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
const traverse=typeof traverseModule==='function'?traverseModule:traverseModule.default,generate=typeof generateModule==='function'?generateModule:generateModule.default;
const keys=new Set();
for(const file of fs.readdirSync('src').filter(v=>v.endsWith('.jsx')&&v!=='CommercialApp.jsx')){
 const path='src/'+file;let source=fs.readFileSync(path,'utf8');const ast=parse(source,{sourceType:'module',plugins:['jsx']});let changed=false;
 const call=v=>({type:'CallExpression',callee:{type:'Identifier',name:'t'},arguments:[{type:'StringLiteral',value:v}]});
 traverse(ast,{
  JSXText(p){const v=p.node.value.replace(/\s+/g,' ').trim();if(!/[\u3400-\u9fff]/.test(v))return;keys.add(v);p.replaceWith({type:'JSXExpressionContainer',expression:call(v)});changed=true;p.skip()},
  StringLiteral(p){const v=p.node.value;if(!/[\u3400-\u9fff]/.test(v))return;if(p.parent.type==='CallExpression'&&p.parent.callee.name==='t')return;
   const attr=p.findParent(v=>v.isJSXAttribute());const inJsx=p.findParent(v=>v.isJSXExpressionContainer());
   if(attr&&p.parent===attr.node){if(!['title','label','text','hint','placeholder','aria-label','alt'].includes(attr.node.name.name))return;attr.node.value={type:'JSXExpressionContainer',expression:call(v)};keys.add(v);changed=true;p.skip();return}
   if(inJsx){keys.add(v);p.replaceWith(call(v));changed=true;p.skip()}
  }
 });
 if(changed){
  if(!source.includes("{t,")&&!source.includes("{t}"))ast.program.body.unshift({type:'ImportDeclaration',specifiers:[{type:'ImportSpecifier',imported:{type:'Identifier',name:'t'},local:{type:'Identifier',name:'t'}}],source:{type:'StringLiteral',value:'./i18n'}});
  fs.writeFileSync(path,generate(ast,{comments:true}).code+'\n');
 }
}
fs.writeFileSync('docs/commercial/translation-keys.json',JSON.stringify([...keys].sort(),null,2));
console.log('Localized JSX strings:',keys.size);
