import fs from 'node:fs';
import path from 'node:path';

const DATA_URL_RE=/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i;

export function profilePhotoFileName(memberId,type='jpeg'){
  const ext=type==='jpeg'||type==='jpg'?'jpg':type;
  return `member-${Number(memberId)}.${ext}`;
}

export function findProfilePhoto(dir,memberId){
  for(const ext of ['jpg','jpeg','png','webp']){
    const file=path.join(dir,`member-${Number(memberId)}.${ext}`);
    if(fs.existsSync(file)&&fs.statSync(file).isFile())return file;
  }
  return null;
}

export function removeProfilePhoto(dir,memberId){
  for(const ext of ['jpg','jpeg','png','webp']){
    try{fs.unlinkSync(path.join(dir,`member-${Number(memberId)}.${ext}`))}catch{}
  }
}

export function decodeProfilePhoto(dataUrl,maxBytes){
  const match=String(dataUrl||'').match(DATA_URL_RE);
  if(!match)throw Object.assign(new Error('Formato de imagen no permitido. Usa JPG, PNG o WebP.'),{statusCode:400,expose:true});
  const type=match[1].toLowerCase()==='jpg'?'jpeg':match[1].toLowerCase();
  const buf=Buffer.from(match[2].replace(/\s/g,''),'base64');
  if(!buf.length||buf.length>maxBytes)throw Object.assign(new Error('La foto es demasiado grande.'),{statusCode:413,expose:true});
  const valid=(type==='jpeg'&&buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)||(type==='png'&&buf.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))||(type==='webp'&&buf.subarray(0,4).toString()==='RIFF'&&buf.subarray(8,12).toString()==='WEBP');
  if(!valid)throw Object.assign(new Error('El archivo no parece ser una imagen válida.'),{statusCode:400,expose:true});
  return{type,buf};
}

export function saveProfilePhoto(dir,memberId,dataUrl,maxBytes){
  const image=decodeProfilePhoto(dataUrl,maxBytes);fs.mkdirSync(dir,{recursive:true,mode:0o700});removeProfilePhoto(dir,memberId);
  const target=path.join(dir,profilePhotoFileName(memberId,image.type)),temp=`${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp,image.buf,{mode:0o600});fs.renameSync(temp,target);return{file:target,bytes:image.buf.length,type:image.type};
}
