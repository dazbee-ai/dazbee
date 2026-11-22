# Cuts the iso object art into web sprites and records where each one touches the ground.
# usage: python3 tools/cut-sprites.py art/city public/sprites/city src/scenes/town-sprites.js
# For each art/city/{buildings,street}/*.png: crop to the object, find the footprint's nearest (bottom) corner and the
# footprint's full screen width, scale to at most 900 px wide and save as webp. The JS file maps name -> size and anchor.
import sys,os,glob,json,numpy as np
from PIL import Image
src,out,js=sys.argv[1:4]
meta={}
for group in ['buildings','street']:
  os.makedirs(f'{out}/{group}',exist_ok=True)
  for f in sorted(glob.glob(f'{src}/{group}/*.png')):
    im=Image.open(f).convert('RGBA');a=np.array(im)[:,:,3]>200
    ys,xs=np.nonzero(a);by=ys.max();bx=xs[ys>=by-3].mean()
    low=ys>by-(by-ys.min())*0.35
    lx=xs[low].min();rx=xs[low].max()
    x0,y0,x1,y1=Image.fromarray((np.array(im)[:,:,3]>8).astype('uint8')*255).getbbox()
    c=im.crop((x0,y0,x1,by+1));w,h=c.size;k=min(1,900/w)
    c=c.resize((round(w*k),round(h*k)),Image.LANCZOS)
    name=os.path.basename(f)[:-4]
    c.save(f'{out}/{group}/{name}.webp',quality=88,method=6)
    meta[name]={'src':f'/sprites/city/{group}/{name}.webp','w':c.size[0],'h':c.size[1],'ax':round((bx-x0)/w,4),'fw':round((rx-lx)/w,4)}
open(js,'w').write('// made by tools/cut-sprites.py: size, ground anchor (ax: nearest corner, as a share of the width) and footprint width (fw)\nexport const SPRITES = '+json.dumps(meta,indent=1)+';\n')
print(json.dumps(meta,indent=0))
