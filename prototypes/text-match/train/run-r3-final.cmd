@echo off
rem PROTOTYPE. Round 3's final GPU queue, each step skipped when done so it can be run again after a power cut:
rem ConvNeXt-Atto on all four realistic sets; its extras, export and int8 copy; MobileNetV4-Conv-Small distilled from it; the student's extras, export and int8 copy.
cd /d C:\dazbee-work\textmatch
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
set PY=C:\dazbee-work\venv\Scripts\python.exe
findstr /c:"done" models\r3l-convnext_atto.log >nul 2>&1 || (echo %date% %time% train convnext >> models\r3-final.log & %PY% train\train2.py --arch convnext_atto --data samples\lib64-r1,samples\lib64-r2,samples\lib64-r3,samples\lib64-r4 --epochs 16 --out models\r3l-convnext_atto >> models\r3l-convnext_atto.log 2>&1)
findstr /c:"done" models\r3l-convnext_atto.log >nul 2>&1 || goto :eof
if not exist models\r3l-convnext_atto\model.onnx (echo %date% %time% finish convnext >> models\r3-final.log & %PY% train\finish2.py --run models\r3l-convnext_atto --steps choose,export >> models\r3l-convnext_atto-finish.log 2>&1)
findstr /c:"done" models\r3d-mnv4.log >nul 2>&1 || (echo %date% %time% distil >> models\r3-final.log & %PY% train\train2.py --arch mobilenetv4_conv_small --teacher models\r3l-convnext_atto --data samples\lib64-r1,samples\lib64-r2 --epochs 16 --mine-from 0 --out models\r3d-mnv4 >> models\r3d-mnv4.log 2>&1)
if not exist models\r3d-mnv4\model.onnx (echo %date% %time% finish student >> models\r3-final.log & %PY% train\finish2.py --run models\r3d-mnv4 --steps choose,export >> models\r3d-mnv4-finish.log 2>&1)
if not exist models\r3l-convnext_atto\fingerprints-int8.f32 (%PY% train\finish2.py --run models\r3l-convnext_atto --steps int8 >> models\r3l-convnext_atto-finish.log 2>&1)
if not exist models\r3d-mnv4\fingerprints-int8.f32 (%PY% train\finish2.py --run models\r3d-mnv4 --steps int8 >> models\r3d-mnv4-finish.log 2>&1)
echo %date% %time% all done >> models\r3-final.log
