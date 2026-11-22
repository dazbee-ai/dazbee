# Flattens the iso ground tiles into square textures for the CSS 3D town.
# usage: python3 tools/unproject-tiles.py art/city/ground public/sprites/city/ground
import sys,glob,os,numpy as np
from PIL import Image
src,out=sys.argv[1],sys.argv[2]
for f in sorted(glob.glob(src+'/*.png')):
  im=Image.open(f).convert('RGBA');a=np.array(im)[:,:,3]>160
  ys,xs=np.nonzero(a)
  ty=ys.min(); tx=int(xs[ys==ty].mean())
  lx=xs.min(); ly=ys[xs==lx].min()
  rx=xs.max(); ry=ys[xs==rx].min()
  # bottom (for info): expected ly+ry-ty
  T=np.array([tx,ty],float);R=np.array([rx,ry],float);L=np.array([lx,ly],float)
  S=512;ins=.045 if "lawn" in f else .025
  # (u,v) in [ins,1-ins]
  k=(1-2*ins)/S
  ex=(R-T)*k; ey=(L-T)*k; o=T+(R-T)*ins+(L-T)*ins
  img=im.transform((S,S),Image.AFFINE,(ex[0],ey[0],o[0],ex[1],ey[1],o[1]),resample=Image.BICUBIC)
  name=os.path.basename(f)[2:-4]
  img.convert('RGB').save(f'{out}/{name}.jpg',quality=86)
  print(name,'T',T,'L',L,'R',R,'w',rx-lx,'h top',(ly+ry)/2-ty)
# roads and zebras also need a turned copy for the north-south streets
for n in ['road','zebra']:
  p=f'{out}/{n}.jpg'
  if os.path.exists(p): Image.open(p).transpose(Image.ROTATE_90).save(f'{out}/{n}-v.jpg',quality=86)
