"""Generate a non-customer video fixture with shapes, text and synthetic speech.

Requires ffmpeg with libflite, libx264 and drawtext. Output goes to the given path.
The synthetic voice is test material, not a recording of a person.
"""
import argparse
import subprocess
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('output')
p.add_argument('--no-audio', action='store_true')
args=p.parse_args()
output=Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
command=['ffmpeg','-hide_banner','-loglevel','error','-y',
         '-f','lavfi','-i','color=c=white:s=640x360:r=12:d=8',
         '-f','lavfi','-i','color=c=blue:s=90x90:r=12:d=8']
visual="[0:v][1:v]overlay=x='30+t*60':y=135:shortest=1,drawtext=text='SMA SYNTHETIC TEST':fontsize=28:fontcolor=black:x=30:y=30[v]"
if args.no_audio:
    command+=['-filter_complex',visual,'-map','[v]','-an']
else:
    command+=['-f','lavfi','-i',"flite=text='This is a synthetic test. A blue square moves from left to right.':voice=slt",
              '-filter_complex',visual+';[2:a]apad=whole_dur=8[a]','-map','[v]','-map','[a]',
              '-c:a','aac','-b:a','64k']
command+=['-t','8','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',str(output)]
subprocess.run(command,check=True)
print('Generated shapes, fixed text and synthetic speech only:',output)
