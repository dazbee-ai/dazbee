"""PROTOTYPE. GPU augmentation of 64-px ink windows for train2.py: what generated ads and their cut-outs do
to letters that the drawn samples (src/make-samples.ts --realistic) don't already show."""

import math

import torch
import torch.nn.functional as F


def crop_windows(strips, widths, gen, win):
    """A random window of each strip (N, H, W uint8); a short strip sits at the left half the time, as
    at match time, else anywhere in the window."""
    n, h, w_strip = strips.shape
    dev = strips.device
    w = widths.float()
    u = torch.rand(n, device=dev, generator=gen)
    long_start = (u * (w - win + 1).clamp(min=1)).floor()
    pad = torch.where(torch.rand(n, device=dev, generator=gen) < 0.5, torch.zeros_like(w), (u * (win - w + 1).clamp(min=1)).floor())
    start = torch.where(w > win, long_start, -pad).long()
    src = start[:, None] + torch.arange(win, device=dev)[None]
    valid = (src >= 0) & (src < widths[:, None])
    cols = src.clamp(0, w_strip - 1)
    out = torch.gather(strips, 2, cols[:, None, :].expand(n, h, win)).float().div(255) * valid[:, None, :]
    return out[:, None]


def _rand(n, gen, dev, lo, hi):
    return lo + (hi - lo) * torch.rand(n, device=dev, generator=gen)


def geometry(x, gen):
    """Horizontal squeeze 5/6-7/6 (DeepFont), height jitter, shear, a small turn, a shift, now and then
    perspective; per-glyph jitter (bands of the window moved up, down and sideways a pixel or two); a
    smooth wobble of the edges."""
    n, _, h, w = x.shape
    dev = x.device
    sx = _rand(n, gen, dev, 5 / 6, 7 / 6)
    sy = _rand(n, gen, dev, 0.92, 1.08)
    shear = _rand(n, gen, dev, -0.12, 0.12)
    rot = _rand(n, gen, dev, -2.0, 2.0) * math.pi / 180
    tx = _rand(n, gen, dev, -0.05, 0.05)
    ty = _rand(n, gen, dev, -0.06, 0.06)
    persp = (torch.rand(n, 1, device=dev, generator=gen) < 0.4) * _rand(n * 2, gen, dev, -0.05, 0.05).view(n, 2)
    # Output pixel (u, v) in [-1, 1] reads source (x, y): scale, shear and turn the grid, then project.
    hgrid = torch.zeros(n, 3, 3, device=dev)
    c, s = torch.cos(rot), torch.sin(rot)
    a = w / h  # aspect, so the turn is a true turn in pixels
    hgrid[:, 0, 0] = c / sx
    hgrid[:, 0, 1] = (-s / a + shear) / sx
    hgrid[:, 1, 0] = s * a / sy
    hgrid[:, 1, 1] = c / sy
    hgrid[:, 0, 2] = tx
    hgrid[:, 1, 2] = ty
    hgrid[:, 2, 0] = persp[:, 0]
    hgrid[:, 2, 1] = persp[:, 1]
    hgrid[:, 2, 2] = 1
    ys, xs = torch.meshgrid(torch.linspace(-1, 1, h, device=dev), torch.linspace(-1, 1, w, device=dev), indexing="ij")
    base = torch.stack([xs, ys, torch.ones_like(xs)], -1).view(1, h * w, 3)
    g = base @ hgrid.transpose(1, 2)
    g = (g[..., :2] / g[..., 2:3]).view(n, h, w, 2)
    # Per-glyph jitter: 12-20 bands across the window, each moved by up to 2 px up/down and 1 px sideways.
    jit = torch.rand(n, device=dev, generator=gen) < 0.5
    if jit.any():
        k = int(torch.randint(12, 21, (1,), device=dev, generator=gen).item())
        dy = (torch.rand(n, 1, 1, k, device=dev, generator=gen) - 0.5) * 2 * (2.0 * 2 / h)
        dx = (torch.rand(n, 1, 1, k, device=dev, generator=gen) - 0.5) * 2 * (1.0 * 2 / w)
        dy = F.interpolate(dy, size=(1, w), mode="nearest").view(n, 1, w)
        dx = F.interpolate(dx, size=(1, w), mode="nearest").view(n, 1, w)
        g[..., 1] += dy * jit[:, None, None]
        g[..., 0] += dx * jit[:, None, None]
    wob = torch.rand(n, device=dev, generator=gen) < 0.3
    if wob.any():
        coarse = (torch.rand(n, 2, 4, 16, device=dev, generator=gen) - 0.5) * 2
        field = F.interpolate(coarse, size=(h, w), mode="bicubic", align_corners=False).permute(0, 2, 3, 1)
        g = g + field * torch.tensor([1.5 * 2 / w, 1.5 * 2 / h], device=dev) * wob[:, None, None, None]
    return F.grid_sample(x, g, align_corners=True, padding_mode="zeros")


def blur(x, sigma):
    n = x.shape[0]
    dev = x.device
    k = torch.arange(-4, 5, device=dev).float()
    ker = torch.exp(-(k[None] ** 2) / (2 * sigma[:, None].clamp(min=0.05) ** 2))
    ker = ker / ker.sum(1, keepdim=True)
    xb = x.transpose(0, 1)
    xb = F.conv2d(F.pad(xb, (4, 4, 0, 0), mode="replicate"), ker[:, None, None, :], groups=n)
    xb = F.conv2d(F.pad(xb, (0, 0, 4, 4), mode="replicate"), ker[:, None, :, None], groups=n)
    return xb.transpose(0, 1)


_DCT = None
_Q = torch.tensor(
    [
        [16, 11, 10, 16, 24, 40, 51, 61],
        [12, 12, 14, 19, 26, 58, 60, 55],
        [14, 13, 16, 24, 40, 57, 69, 56],
        [14, 17, 22, 29, 51, 87, 80, 62],
        [18, 22, 37, 56, 68, 109, 103, 77],
        [24, 35, 55, 64, 81, 104, 113, 92],
        [49, 64, 78, 87, 103, 121, 120, 101],
        [72, 92, 95, 98, 112, 100, 103, 99],
    ],
    dtype=torch.float32,
)


def jpeg(x, quality):
    """JPEG's loss on 8x8 blocks: the DCT rounded by the luminance table at a quality, then undone."""
    global _DCT
    dev = x.device
    if _DCT is None or _DCT.device != dev:
        i = torch.arange(8, device=dev).float()
        d = torch.cos((2 * i[None] + 1) * i[:, None] * math.pi / 16) * math.sqrt(2 / 8)
        d[0] /= math.sqrt(2)
        _DCT = d
    n, _, h, w = x.shape
    scale = torch.where(quality < 50, 50 / quality, 2 - quality / 50)
    q = (_Q.to(dev)[None] * scale[:, None, None]).clamp(min=1) / 255
    b = x.view(n, h // 8, 8, w // 8, 8).permute(0, 1, 3, 2, 4)
    c = _DCT @ (b - 0.5) @ _DCT.t()
    c = torch.round(c / q[:, None, None]) * q[:, None, None]
    b = _DCT.t() @ c @ _DCT + 0.5
    return b.permute(0, 1, 3, 2, 4).reshape(n, 1, h, w)


def augment_batch(x, gen):
    n = x.shape[0]
    dev = x.device
    x = geometry(x, gen)
    # Lost resolution: down to 12-48 px high and back.
    low = torch.rand(n, device=dev, generator=gen) < 0.4
    if low.any():
        hh = int(torch.randint(12, 49, (1,), device=dev, generator=gen).item())
        _, _, h, w = x.shape
        small = F.interpolate(x[low], size=(hh, max(8, round(w * hh / h))), mode="area")
        x[low] = F.interpolate(small, size=(h, w), mode="bilinear", align_corners=False)
    # Strokes a little thicker or thinner.
    morph = torch.rand(n, device=dev, generator=gen)
    thick, thin = morph < 0.1, morph > 0.9
    if thick.any():
        x[thick] = F.max_pool2d(x[thick], 3, 1, 1) * 0.5 + x[thick] * 0.5
    if thin.any():
        x[thin] = -F.max_pool2d(-x[thin], 3, 1, 1) * 0.5 + x[thin] * 0.5
    sig = torch.where(torch.rand(n, device=dev, generator=gen) < 0.6, _rand(n, gen, dev, 0.0, 1.6), torch.zeros(n, device=dev))
    x = blur(x, sig)
    gamma = torch.exp((torch.rand(n, 1, 1, 1, device=dev, generator=gen) - 0.5) * 0.9)
    peak = 0.55 + 0.45 * torch.rand(n, 1, 1, 1, device=dev, generator=gen)
    x = x.clamp(0, 1) ** gamma * peak
    jp = torch.rand(n, device=dev, generator=gen) < 0.3
    if jp.any():
        x[jp] = jpeg(x[jp], _rand(int(jp.sum()), gen, dev, 20, 85))
    x = x + torch.randn(x.shape, device=dev, generator=gen) * (torch.rand(n, 1, 1, 1, device=dev, generator=gen) * 0.06)
    return x.clamp(0, 1)
