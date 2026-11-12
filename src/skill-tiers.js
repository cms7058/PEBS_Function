export const tierLabel=tier=>tier==='ultra'?'Ultra':tier==='high'?'high':'normal';
export const tierRank=tier=>({normal:0,high:1,ultra:2}[tier]??3);
export const allowsSkill=(profile,skill)=>Math.max(tierRank(skill.capability_tier||'normal'),...(skill.capabilities||[]).map(c=>tierRank(c.tier||'normal')))<=tierRank(profile?.tier||'normal');
export function capabilityGroups(skills){
 const groups=new Map();for(const skill of skills){for(const capability of skill.capabilities||[]){if(!groups.has(capability.id))groups.set(capability.id,{id:capability.id,label:capability.label,items:[]});groups.get(capability.id).items.push({skill,capability})}}
 return [...groups.values()].sort((a,b)=>b.items.length-a.items.length||a.label.localeCompare(b.label,'zh')).map(g=>({...g,items:g.items.sort((a,b)=>tierRank(b.capability.tier)-tierRank(a.capability.tier)||(b.capability.score||0)-(a.capability.score||0))}));
}
