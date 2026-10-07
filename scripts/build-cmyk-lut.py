"""สร้างตาราง soft-proof (3D LUT) สำหรับจำลองสีงานพิมพ์ CMYK บนจอ → src/core/cmykProofLut.ts

แปลงสีแต่ละจุดในกริด RGB ผ่าน ICC จริง (LittleCMS ผ่าน Pillow):
  sRGB → CMYK (relative colorimetric + black point compensation)  = สิ่งที่โรงพิมพ์ทำตอนแยกสี
  CMYK → sRGB (relative colorimetric + black point compensation)  = แสดงผลกลับบนจอ
ผล: สีที่อยู่นอก gamut ของหมึก (ฟ้า/เขียว/ส้มสด ๆ) ถูกบีบเข้ามา
แล้วแก้ gray balance: วัดว่าเทา 256 ระดับวนกลับมาเป็นสีอะไร (profile SWOP รุ่นเก่าให้เทาอมเหลือง
และยกดำ/เทากลางขึ้น ~10 ระดับ) แล้วสร้างเส้นโค้งแก้ต่อช่องให้เทากลับเป็นค่าเดิมเป๊ะ — เทียบเท่าแท่นพิมพ์
ที่คาลิเบรต gray balance (แนว G7) จึงขาว/ดำ/เทาไม่เพี้ยน เหลือแต่การหลุด gamut ซึ่งเป็นเรื่องที่ผู้ใช้ต้องรู้

ใช้:  python scripts/build-cmyk-lut.py [path/to/cmyk-profile.icc]
ค่าเริ่มต้นใช้ RSWOP.icm ที่มากับ Windows (SWOP coated) — เปลี่ยนเป็น profile โรงพิมพ์จริง
(เช่น FOGRA39 / GRACoL) ได้โดยส่ง path เข้ามา แล้ว commit ไฟล์ .ts ที่ได้
"""

import base64
import sys
from pathlib import Path

from PIL import Image, ImageCms

CHROMA_FADE = 64  # ความอิ่มสี (max−min ของ RGB) ที่การแก้ gray balance จางหายหมด
N = 17  # จุดต่อแกน — 17³ = 4913 สี พอสำหรับ interpolate แบบ trilinear บนพรีวิว
DEFAULT_PROFILE = r"C:\Windows\System32\spool\drivers\color\RSWOP.icm"
OUT = Path(__file__).resolve().parent.parent / "src" / "core" / "cmykProofLut.ts"


def inverse_curve(response: list[int]) -> list[int]:
    """ตาราง 256 ค่า: ค่าที่ออกมา (response[v]) → v เดิม; interpolate เชิงเส้น ตัดปลายที่ 0/255
    response ต้องเพิ่มขึ้นตาม v (ทำให้ไม่ลดลงก่อน กันจุดสะดุดเล็ก ๆ ของ profile)"""
    xs = []
    hi = -1
    for r in response:
        hi = max(hi, r)
        xs.append(hi)
    out = []
    for z in range(256):
        if z <= xs[0]:
            out.append(0)
            continue
        if z >= xs[-1]:
            out.append(255)
            continue
        k = next(i for i in range(1, 256) if xs[i] >= z)
        x0, x1 = xs[k - 1], xs[k]
        t = 0.0 if x1 == x0 else (z - x0) / (x1 - x0)
        out.append(round(k - 1 + t))
    return out


def main() -> None:
    profile_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROFILE
    cmyk = ImageCms.getOpenProfile(profile_path)
    srgb = ImageCms.createProfile("sRGB")
    desc = ImageCms.getProfileDescription(cmyk).strip()

    flags = ImageCms.Flags.BLACKPOINTCOMPENSATION
    intent = ImageCms.Intent.RELATIVE_COLORIMETRIC
    to_cmyk = ImageCms.buildTransform(srgb, cmyk, "RGB", "CMYK", intent, flags)
    to_rgb = ImageCms.buildTransform(cmyk, srgb, "CMYK", "RGB", intent, flags)

    # กริด N³ เรียง r ช้าสุด → b เร็วสุด (index = (ri*N + gi)*N + bi) วางเป็นภาพแถวเดียวยาว N³ พิกเซล
    step = 255 / (N - 1)
    grid = Image.new("RGB", (N * N * N, 1))
    grid.putdata(
        [
            (round(ri * step), round(gi * step), round(bi * step))
            for ri in range(N)
            for gi in range(N)
            for bi in range(N)
        ]
    )
    proofed = ImageCms.applyTransform(ImageCms.applyTransform(grid, to_cmyk), to_rgb)
    raw = proofed.tobytes()
    assert len(raw) == N * N * N * 3

    # gray balance: เทา v วนกลับมาเป็น (Rv, Gv, Bv) → เส้นโค้งต่อช่องที่พา Rv→v, Gv→v, Bv→v
    ramp = Image.new("RGB", (256, 1))
    ramp.putdata([(v, v, v) for v in range(256)])
    gray = ImageCms.applyTransform(ImageCms.applyTransform(ramp, to_cmyk), to_rgb).tobytes()
    curves = [inverse_curve([gray[v * 3 + c] for v in range(256)]) for c in range(3)]

    # เส้นโค้งวัดจากสีเทา จึงใช้เต็มที่เฉพาะสีที่เกือบเทา แล้วค่อย ๆ จางหายเมื่อสีอิ่มขึ้น — ถ้าใช้กับทุกสี
    # จะกดช่องแดงของแดงสดลงผิด (#e65048 ที่พิมพ์ได้จริง กลายเป็นแดงอิฐ) ส่วนสีอิ่มใช้ผล profile ตรง ๆ
    data = bytearray(len(raw))
    for gi_ in range(N * N * N):
        ri, rem = divmod(gi_, N * N)
        gi, bi = divmod(rem, N)
        src = (ri * step, gi * step, bi * step)
        t = max(0.0, 1.0 - (max(src) - min(src)) / CHROMA_FADE)
        w = t * t * (3 - 2 * t)  # smoothstep
        for c in range(3):
            r = raw[gi_ * 3 + c]
            data[gi_ * 3 + c] = round(r + w * (curves[c][r] - r))
    data = bytes(data)

    b64 = base64.b64encode(data).decode("ascii")
    lines = [b64[i : i + 100] for i in range(0, len(b64), 100)]
    body = "\n".join(f"  '{ln}' +" for ln in lines)[: -len(" +")]
    OUT.write_text(
        "// ไฟล์ถูก generate โดย scripts/build-cmyk-lut.py — อย่าแก้ตรง ๆ ให้รันสคริปต์ใหม่\n"
        f"// profile: {desc} (sRGB → CMYK → sRGB, relative colorimetric + BPC, แก้ gray balance)\n"
        f"export const CMYK_PROOF_PROFILE = {desc!r}\n"
        f"export const CMYK_PROOF_N = {N}\n"
        "// RGB 8 บิตต่อช่อง ต่อจุดกริด เรียง index = (ri*N + gi)*N + bi (r ช้าสุด) — ดู softProof.ts\n"
        "export const CMYK_PROOF_LUT_B64 =\n"
        f"{body}\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"wrote {OUT} ({len(data)} bytes, profile: {desc})")


if __name__ == "__main__":
    main()
