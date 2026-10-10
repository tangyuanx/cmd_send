// Literal, case-insensitive matching with offsets in the original UTF-16 text.
// Lowercasing the entire document can change its length (for example, İ).
export function literalMatches(text,query){
  if(!query)return [];
  const pattern=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return Array.from(text.matchAll(new RegExp(pattern,'giu')),match=>({start:match.index,end:match.index+match[0].length}));
}
