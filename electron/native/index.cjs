'use strict';
module.exports.createBackend=()=>{
  if(process.platform==='darwin')return require('./mac.cjs').createBackend();
  if(process.platform==='win32')return require('./windows.cjs').createBackend();
  throw new Error('目前只支持 macOS 和 Windows');
};
