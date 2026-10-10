import {test} from 'node:test';import assert from 'node:assert/strict';
import {literalMatches} from '../src/search.js';
test('case-insensitive search preserves exact source offsets after Unicode casing and emoji',()=>{
 const text='İ HEADER 中😀 test TEST';
 const matches=literalMatches(text,'test');assert.deepEqual(matches,[{start:13,end:17},{start:18,end:22}]);
 assert.deepEqual(matches.map(m=>text.slice(m.start,m.end)),['test','TEST']);
 assert.deepEqual(literalMatches(text,'中😀'),[{start:9,end:12}]);
});
test('search punctuation and HTML are literal, with non-overlapping matches',()=>{
 assert.deepEqual(literalMatches('[a].* <tag> [a].*','[a].*'),[{start:0,end:5},{start:12,end:17}]);
 assert.deepEqual(literalMatches('<tag>','<tag>'),[{start:0,end:5}]);
 assert.deepEqual(literalMatches('aaaaa','aa'),[{start:0,end:2},{start:2,end:4}]);
});
test('empty or absent search yields no matches',()=>{
 assert.deepEqual(literalMatches('hello',''),[]);assert.deepEqual(literalMatches('','hello'),[]);assert.deepEqual(literalMatches('hello','no'),[]);
});
