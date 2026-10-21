import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
await sharp('assets/icon.svg').png().toFile('assets/icon.png');
await writeFile('assets/icon.ico',await pngToIco('assets/icon.png'));
if(process.platform==='darwin'){
  await mkdir('release/icon.iconset',{recursive:true});
  for(const size of [16,32,128,256,512])for(const scale of [1,2]){
    await sharp('assets/icon.svg').resize(size*scale).png().toFile(`release/icon.iconset/icon_${size}x${size}${scale===2?'@2x':''}.png`);
  }
  execFileSync('iconutil',['-c','icns','release/icon.iconset','-o','assets/icon.icns']);
}
