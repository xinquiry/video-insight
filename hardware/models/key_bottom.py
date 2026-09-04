"""下壳：空心圆角盒 + 止口凸台（公）+ 按钮位一个小凸起（垫微动开关）。

运行（仓库根目录）：
  hardware/.venv/bin/python hardware/models/key_bottom.py
输出 hardware/print/key_bottom.stl，并打印体积验证空心、水密。

止口凸台做法：外环 − 内环 = 上下开口的纯环壁（无顶无底），不会被平面封口，
与内腔同心 → 角部无镂空、无多余平台。
"""
import os
import cadquery as cq
import trimesh

# ---- 参数 ----
L, W = 132.0, 46.0     # 长/宽
BOT_H = 14.0           # 下壳高
R = 12.0               # 四角圆角
WALL = 2.0             # 壁厚
RAB_H = 2.5            # 止口凸台高度（伸进上壳的量）
RAB_T = 1.2            # 止口凸台厚度（径向）
BTN_CX = -L / 2 + 36.0 # 按钮中心 X
POST_D = 12.0          # 凸起直径
# 凸起顶面目标高度 z = h2 - h1 - 5 = 27 - 12 - 5 = 10（从下壳底面 z=0 算）。
# 凸起从内腔底 z=WALL=2 长出，所以建模高度 = 10 - 2 = 8。
POST_H = 8.0           # 凸起建模高度（内腔底起算），顶面正好在 z=10

# ---- 空心盒：box → 竖棱圆角 → shell 抽壳（顶面开口）----
bottom = (
    cq.Workplane("XY")
    .box(L, W, BOT_H, centered=(True, True, False))
    .edges("|Z").fillet(R)
    .faces(">Z").shell(-WALL)
)

# ---- 止口凸台（公）：口部一圈上下开口的环壁，伸进上壳凹槽 ----
boss_outer = (
    cq.Workplane("XY")
    .box(L - 2 * WALL, W - 2 * WALL, RAB_H + 0.5, centered=(True, True, False))
    .edges("|Z").fillet(R - WALL)
    .translate((0, 0, BOT_H - 0.5))
)
boss_inner = (
    cq.Workplane("XY")
    .box(L - 2 * WALL - 2 * RAB_T, W - 2 * WALL - 2 * RAB_T, RAB_H + 1.5,
         centered=(True, True, False))
    .edges("|Z").fillet(max(0.5, R - WALL - RAB_T))
    .translate((0, 0, BOT_H - 0.5))
)
boss = boss_outer.cut(boss_inner)   # 中空环壁
bottom = bottom.union(boss)

# ---- 按钮位小凸起 ----
post = (
    cq.Workplane("XY")
    .circle(POST_D / 2).extrude(POST_H)
    .translate((BTN_CX, 0, WALL))
)
bottom = bottom.union(post)

OUT = os.path.join(os.path.dirname(__file__), "..", "print", "key_bottom.stl")
cq.exporters.export(bottom, OUT)

m = trimesh.load(OUT)
solid_vol = L * W * BOT_H
print("实体积(实心参考):", round(solid_vol))
print("模型体积:", round(m.volume), "→ 空心" if m.volume < solid_vol * 0.75 else "→ 仍实心!")
print("水密:", m.is_watertight, "bounds:", m.bounds.round(1).tolist())
print("输出:", os.path.abspath(OUT))
