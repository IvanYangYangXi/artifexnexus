"""生成 Windows ICO 图标文件。"""
import struct
import os

def create_ico(filepath, width=32, height=32):
    """创建蓝色方块 ICO 文件。"""
    # BMP 数据（32-bit BGRA，从下到上）
    bmp_data = b''
    for y in range(height - 1, -1, -1):
        for x in range(width):
            bmp_data += b'\xff\x82\x3b\xff'  # BGRA blue

    # BMP 信息头
    bmp_header = struct.pack('<IiiHHIIiiII',
        40,                # header size
        width,             # width
        height * 2,        # height (ICO: double for AND mask)
        1,                 # planes
        32,                # bpp
        0,                 # compression
        len(bmp_data),     # image size
        0, 0, 0, 0         # resolution
    )

    # AND mask (1 bit per pixel, all transparent = all 0)
    and_mask_size = ((width + 31) // 32) * 4 * height
    and_mask = b'\x00' * and_mask_size

    full_bmp = bmp_header + bmp_data + and_mask

    # ICO 头部
    ico_header = struct.pack('<HHH', 0, 1, 1)  # reserved, type=1, count=1

    # ICO 目录项
    offset = 6 + 16  # header + 1 entry
    ico_entry = struct.pack('<BBBBHHII',
        width if width < 256 else 0,
        height if height < 256 else 0,
        0, 0,          # palette, reserved
        1,             # color planes
        32,            # bpp
        len(full_bmp), # size
        offset         # offset
    )

    with open(filepath, 'wb') as f:
        f.write(ico_header + ico_entry + full_bmp)

    print(f'ICO created: {filepath} ({os.path.getsize(filepath)} bytes)')


if __name__ == '__main__':
    target = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'apps', 'desktop', 'src-tauri', 'icons', 'icon.ico'
    )
    create_ico(target)
