import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
import numpy as np
import time
import os
import math
import random
from collections import deque

################################################################################
# CONFIGURATION & CONSTANTS
################################################################################

MAGIC_CIRCLE_PATH = "magic_circle.png"
MANDALA_IMAGE_PATH = "depositphotos_264881212-stock-illustration-magic-spell-ring-magic-circle.jpg"

# Spell Modes
MODE_TAO_MANDALA = 1
MODE_SLING_RING = 2
MODE_CRIMSON_BANDS = 3
MODE_TIME_STONE = 4

################################################################################
# GRAPHICS GENERATORS & FILTERS
################################################################################

def generate_default_magic_circle(size=800):
    img = np.zeros((size, size, 4), dtype=np.uint8)
    center = (size // 2, size // 2)
    color = (50, 200, 255, 255) # Gold
    
    cv2.circle(img, center, size//2 - 10, color, 6, cv2.LINE_AA)
    cv2.circle(img, center, size//2 - 30, color, 2, cv2.LINE_AA)
    cv2.circle(img, center, size//2 - 40, color, 1, cv2.LINE_AA)
    
    inner_rad = size//4 + 20
    cv2.circle(img, center, inner_rad, color, 4, cv2.LINE_AA)
    cv2.circle(img, center, inner_rad - 15, color, 1, cv2.LINE_AA)
    
    radius = size//2 - 45
    for offset_angle in [0, 60]:
        points = []
        for i in range(3):
            angle = math.radians(i * 120 - 90 + offset_angle)
            points.append([int(center[0] + radius * math.cos(angle)), 
                           int(center[1] + radius * math.sin(angle))])
        cv2.polylines(img, [np.array(points)], True, color, 3, cv2.LINE_AA)
        
    points_sq = []
    for i in range(4):
        angle = math.radians(i * 90 - 45)
        points_sq.append([int(center[0] + radius * math.cos(angle)), 
                          int(center[1] + radius * math.sin(angle))])
    cv2.polylines(img, [np.array(points_sq)], True, color, 2, cv2.LINE_AA)
    
    band_inner = inner_rad + 10
    band_outer = radius - 10
    for i in range(36):
        angle = math.radians(i * 10)
        r1 = band_inner if i % 2 == 0 else band_inner + 15
        r2 = band_outer if i % 3 == 0 else band_outer - 20
        pt1 = (int(center[0] + r1 * math.cos(angle)), int(center[1] + r1 * math.sin(angle)))
        pt2 = (int(center[0] + r2 * math.cos(angle)), int(center[1] + r2 * math.sin(angle)))
        thickness = 3 if i % 2 == 0 else 1
        cv2.line(img, pt1, pt2, color, thickness, cv2.LINE_AA)
        
    cv2.ellipse(img, center, (size//6, size//12), 0, 0, 360, color, 4, cv2.LINE_AA)
    cv2.ellipse(img, center, (size//12, size//6), 0, 0, 360, color, 2, cv2.LINE_AA)
    cv2.circle(img, center, size//20, color, -1)
    cv2.circle(img, center, size//40, (0,0,0,0), -1)
    
    for i in range(8):
        angle = math.radians(i * 45)
        cx = int(center[0] + (inner_rad - 40) * math.cos(angle))
        cy = int(center[1] + (inner_rad - 40) * math.sin(angle))
        cv2.circle(img, (cx, cy), 15, color, 2, cv2.LINE_AA)
        cv2.circle(img, (cx, cy), 5, color, -1)

    return img

def recolor_magic_circle(img_bgra, hue_target, b_boost, g_boost, r_boost):
    """Generic recoloring function for spells."""
    bgr = img_bgra[:,:,:3]
    alpha = img_bgra[:,:,3]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    
    mask = alpha > 10
    if np.any(mask):
        mean_val = np.mean(gray[mask])
        if mean_val < 100:  
            gray = 255 - gray
            
    gray_normalized = gray.astype(np.float32) / 255.0
    gray_normalized = np.clip(gray_normalized * 1.5, 0, 1.0) 
    
    neon = np.zeros_like(bgr)
    neon[:, :, 0] = b_boost   # Blue
    neon[:, :, 1] = g_boost   # Green
    neon[:, :, 2] = r_boost   # Red
    
    for c in range(3):
        neon[:, :, c] = (neon[:, :, c] * gray_normalized).astype(np.uint8)
    
    return np.dstack((neon, alpha))

################################################################################
# HELPER FUNCTIONS
################################################################################

def overlay_transparent(background, overlay, x, y):
    bg_h, bg_w = background.shape[:2]
    h, w = overlay.shape[:2]

    if x >= bg_w or y >= bg_h or x + w <= 0 or y + h <= 0:
        return background

    x_min, x_max = max(x, 0), min(x + w, bg_w)
    y_min, y_max = max(y, 0), min(y + h, bg_h)

    overlay_x_min = max(0, -x)
    overlay_x_max = w - max(0, (x + w) - bg_w)
    overlay_y_min = max(0, -y)
    overlay_y_max = h - max(0, (y + h) - bg_h)

    overlay_crop = overlay[overlay_y_min:overlay_y_max, overlay_x_min:overlay_x_max]
    bg_crop = background[y_min:y_max, x_min:x_max]

    alpha = overlay_crop[:, :, 3] / 255.0
    alpha_inv = 1.0 - alpha

    for c in range(3):
        bg_crop[:, :, c] = (alpha * overlay_crop[:, :, c] + alpha_inv * bg_crop[:, :, c])

    background[y_min:y_max, x_min:x_max] = bg_crop
    return background


def rotate_image(image, angle):
    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0,0,0,0))
    return rotated

def tilt_circle_3d(image, pitch_angle, yaw_angle):
    """Fake 3D perspective tilt by warping the corners"""
    h, w = image.shape[:2]
    
    # Calculate offset based on angles
    offset_x = int(w * math.sin(math.radians(yaw_angle)) * 0.3)
    offset_y = int(h * math.sin(math.radians(pitch_angle)) * 0.3)
    
    src_pts = np.float32([[0, 0], [w-1, 0], [0, h-1], [w-1, h-1]])
    
    # Warping corners based on tilt
    dst_pts = np.float32([
        [0 + offset_x, 0 - offset_y], 
        [w-1 - offset_x, 0 + offset_y], 
        [0 - offset_x, h-1 - offset_y], 
        [w-1 + offset_x, h-1 + offset_y]
    ])
    
    # Ensure points don't cross to avoid OpenCV assertion errors
    if dst_pts[0][0] >= dst_pts[1][0] or dst_pts[0][1] >= dst_pts[2][1]: return image

    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped = cv2.warpPerspective(image, M, (w, h), borderMode=cv2.BORDER_CONSTANT, borderValue=(0,0,0,0))
    return warped

################################################################################
# GESTURE RECOGNITION
################################################################################

def is_open_palm(hand_landmarks):
    wrist = hand_landmarks[0]
    fingers = [(4, 2), (8, 6), (12, 10), (16, 14), (20, 18)]
    for tip_idx, base_idx in fingers:
        tip = hand_landmarks[tip_idx]
        base = hand_landmarks[base_idx]
        dist_tip = (tip.x - wrist.x)**2 + (tip.y - wrist.y)**2
        dist_base = (base.x - wrist.x)**2 + (base.y - wrist.y)**2
        if dist_tip < dist_base: return False
    return True

def is_pointing(hand_landmarks):
    """Index and middle fingers extended, others closed"""
    wrist = hand_landmarks[0]
    
    # Open fingers
    index_open = ((hand_landmarks[8].x - wrist.x)**2 + (hand_landmarks[8].y - wrist.y)**2) > ((hand_landmarks[6].x - wrist.x)**2 + (hand_landmarks[6].y - wrist.y)**2)
    middle_open = ((hand_landmarks[12].x - wrist.x)**2 + (hand_landmarks[12].y - wrist.y)**2) > ((hand_landmarks[10].x - wrist.x)**2 + (hand_landmarks[10].y - wrist.y)**2)
    
    # Closed fingers
    ring_closed = ((hand_landmarks[16].x - wrist.x)**2 + (hand_landmarks[16].y - wrist.y)**2) < ((hand_landmarks[14].x - wrist.x)**2 + (hand_landmarks[14].y - wrist.y)**2)
    pinky_closed = ((hand_landmarks[20].x - wrist.x)**2 + (hand_landmarks[20].y - wrist.y)**2) < ((hand_landmarks[18].x - wrist.x)**2 + (hand_landmarks[18].y - wrist.y)**2)
    
    return index_open and middle_open and ring_closed and pinky_closed

def is_fist(hand_landmarks):
    wrist = hand_landmarks[0]
    fingers = [(8, 6), (12, 10), (16, 14), (20, 18)]
    for tip_idx, base_idx in fingers:
        tip = hand_landmarks[tip_idx]
        base = hand_landmarks[base_idx]
        dist_tip = (tip.x - wrist.x)**2 + (tip.y - wrist.y)**2
        dist_base = (base.x - wrist.x)**2 + (base.y - wrist.y)**2
        if dist_tip > dist_base: return False # If any finger is extended, not a fist
    return True

def is_spider_man_pose(hand_landmarks):
    """Index and Pinky extended, Middle and Ring closed (Dr. Strange / Spider-Man)"""
    wrist = hand_landmarks[0]
    
    # Open fingers
    index_open = ((hand_landmarks[8].x - wrist.x)**2 + (hand_landmarks[8].y - wrist.y)**2) > ((hand_landmarks[6].x - wrist.x)**2 + (hand_landmarks[6].y - wrist.y)**2)
    pinky_open = ((hand_landmarks[20].x - wrist.x)**2 + (hand_landmarks[20].y - wrist.y)**2) > ((hand_landmarks[18].x - wrist.x)**2 + (hand_landmarks[18].y - wrist.y)**2)
    
    # Closed fingers
    middle_closed = ((hand_landmarks[12].x - wrist.x)**2 + (hand_landmarks[12].y - wrist.y)**2) < ((hand_landmarks[10].x - wrist.x)**2 + (hand_landmarks[10].y - wrist.y)**2)
    ring_closed = ((hand_landmarks[16].x - wrist.x)**2 + (hand_landmarks[16].y - wrist.y)**2) < ((hand_landmarks[14].x - wrist.x)**2 + (hand_landmarks[14].y - wrist.y)**2)
    
    return index_open and pinky_open and middle_closed and ring_closed

################################################################################
# SPELL RENDERING LOGIC
################################################################################

def render_crimson_bands(frame, wrist_pos, time_seconds):
    """Draws writhing crimson energy whips from the fist"""
    h, w, _ = frame.shape
    wx, wy = wrist_pos
    
    num_whips = 5
    for i in range(num_whips):
        points = []
        cx, cy = wx, wy
        
        # Whip properties
        length = 400
        segments = 20
        angle_base = math.radians(i * (360 / num_whips) + (time_seconds * 50))
        
        for j in range(segments):
            points.append((int(cx), int(cy)))
            
            # Wriggle effect using sine waves
            wriggle = math.sin(time_seconds * 10 + j * 0.5 + i) * 30
            
            dx = math.cos(angle_base) * (length / segments) + math.sin(angle_base) * wriggle
            dy = math.sin(angle_base) * (length / segments) + math.cos(angle_base) * wriggle
            
            cx += dx
            cy += dy
            
        # Draw the whip segments
        for k in range(1, len(points)):
            thickness = max(1, 15 - k*2)
            alpha_line = max(0.1, 1.0 - k/segments)
            
            # Neon red glow overlay
            overlay = frame.copy()
            cv2.line(overlay, points[k-1], points[k], (50, 50, 255), thickness + 4, cv2.LINE_AA)
            cv2.addWeighted(overlay, alpha_line * 0.5, frame, 1 - alpha_line * 0.5, 0, frame)
            
            # Core bright white line
            cv2.line(frame, points[k-1], points[k], (200, 200, 255), thickness, cv2.LINE_AA)


################################################################################
# MAIN EXECUTION
################################################################################

def main():
    print("==================================================")
    print(" SANCTUM SANCTORUM AR: MYSTIC ARTS INITIATED      ")
    print("==================================================")
    print(" [KEYBOARD SPELL SELECTION ACTIVE]                ")
    print(" [1] ✋ Tao Mandalas (Eldritch Shields)           ")
    print(" [2] ✌️  Sling Ring Portals                       ")
    print(" [3] ✋ Time Stone (Open Palm)                    ")
    print(" PRESS [Q] - Disengage                            ")
    print("==================================================")

    # 1. Load Assets
    if os.path.exists(MAGIC_CIRCLE_PATH):
        raw_circle = cv2.imread(MAGIC_CIRCLE_PATH, cv2.IMREAD_UNCHANGED)
        if raw_circle.shape[2] == 3:
            alpha = np.ones(raw_circle.shape[:2], dtype=np.uint8) * 255
            raw_circle = np.dstack((raw_circle, alpha))
    else:
        raw_circle = generate_default_magic_circle(size=600)

    # Load Tao Mandala from stock image (black background -> alpha extraction)
    mandala_img = None
    mandala_path_bytes = np.fromfile(MANDALA_IMAGE_PATH, dtype=np.uint8)
    mandala_raw = cv2.imdecode(mandala_path_bytes, cv2.IMREAD_COLOR)
    if mandala_raw is not None:
        # Convert black background to transparent alpha channel
        gray = cv2.cvtColor(mandala_raw, cv2.COLOR_BGR2GRAY)
        _, alpha_mask = cv2.threshold(gray, 25, 255, cv2.THRESH_BINARY)
        # Smooth the edges
        alpha_mask = cv2.GaussianBlur(alpha_mask, (5, 5), 0)
        mandala_img = np.dstack((mandala_raw, alpha_mask))
        print("[System] Loaded stock mandala image successfully.")
    else:
        print("[Warning] Could not load mandala image, using generated circle.")

    # Pre-calculate Spell Graphics
    spell_assets = {
        MODE_TIME_STONE: recolor_magic_circle(raw_circle, 60, 50, 255, 50),
        MODE_TAO_MANDALA: mandala_img if mandala_img is not None else recolor_magic_circle(raw_circle, 20, 50, 150, 255)
    }

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    # State variables
    current_mode = MODE_TAO_MANDALA
    current_angle = 0.0
    last_time = time.time()
    
    # Sling Ring variables
    sling_ring_trail = deque(maxlen=150) # Increased trail length to allow slower drawing
    sling_ring_sparks = []
    portal_open = False
    portal_scale = 0.0
    portal_center = (0, 0)
    
    # Time stone variables
    trail_deque = deque(maxlen=6)
    prev_cx, prev_cy = None, None



    # Initialize MediaPipe Hands
    base_options = mp_python.BaseOptions(model_asset_path='hand_landmarker.task')
    options = vision.HandLandmarkerOptions(
        base_options=base_options,
        num_hands=2,
        min_hand_detection_confidence=0.7,
        min_hand_presence_confidence=0.7,
        min_tracking_confidence=0.7)

    with vision.HandLandmarker.create_from_options(options) as landmarker:
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
                
            frame = cv2.flip(frame, 1) 
            h_img, w_img, _ = frame.shape
            
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            detection_result = landmarker.detect(mp_image)

            current_time = time.time()
            dt = current_time - last_time
            last_time = current_time

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'): break
            
            # Keyboard Toggles to Switch Modes
            active_time_stone_hand = False
            
            new_mode = current_mode
            if key == ord('1'): new_mode = MODE_TAO_MANDALA
            elif key == ord('2'): new_mode = MODE_SLING_RING
            elif key == ord('3'): new_mode = MODE_TIME_STONE
            
            if new_mode != current_mode:
                current_mode = new_mode
                sling_ring_trail.clear()
                sling_ring_sparks.clear()
                trail_deque.clear()
                portal_open = False
                portal_scale = 0.0

            # Rotation physics applies to Shield and Time Stone
            current_angle += (100.0 * dt)

            # Display Current Mode
            mode_names = {0:"[WAITING FOR GESTURE]", 1:"TAO MANDALAS", 2:"SLING RING", 3:"TIME STONE"}
            cv2.putText(frame, mode_names.get(current_mode, ""), (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2, cv2.LINE_AA)

            if detection_result.hand_landmarks:
                hands = detection_result.hand_landmarks
                pointing_hands = [h for h in hands if is_pointing(h)]
                
                for hand_landmarks in hands:
                    wrist = hand_landmarks[0]
                    wx, wy = int(wrist.x * w_img), int(wrist.y * h_img)
                    
                    # ---------------------------------------------------------
                    # SPELL 1: TAO MANDALAS (Open Palm, Both hands, 3D Shield)
                    # ---------------------------------------------------------
                    if current_mode == MODE_TAO_MANDALA and is_open_palm(hand_landmarks):
                        palm_center = hand_landmarks[9]
                        cx, cy = int(palm_center.x * w_img), int(palm_center.y * h_img)
                        target_size = int(math.hypot(cx - wx, cy - wy) * 4.0)
                        
                        if target_size > 20:
                            # Perspective Tilt calculation
                            dx = cx - wx
                            dy = cy - wy
                            yaw = np.clip(dx * 0.5, -45, 45)
                            pitch = np.clip(dy * 0.5, -45, 45)
                            
                            scaled_circle = cv2.resize(spell_assets[MODE_TAO_MANDALA], (target_size, target_size), interpolation=cv2.INTER_AREA)
                            rotated = rotate_image(scaled_circle, current_angle)
                            tilted = tilt_circle_3d(rotated, pitch, yaw)
                            
                            top_left_x = cx - target_size // 2
                            top_left_y = cy - target_size // 2
                            
                            # Add energetic motion blur via a quick blend
                            frame = overlay_transparent(frame, tilted, top_left_x, top_left_y)
                            
                    # ---------------------------------------------------------
                    # SPELL 2: SLING RING PORTALS (Dual Pointing Hands)
                    # ---------------------------------------------------------
                    elif current_mode == MODE_SLING_RING and len(pointing_hands) >= 2:
                        # Sort left vs right hand by screen X coordinate
                        xs = [h[0].x for h in pointing_hands[:2]]
                        if xs[0] < xs[1]:  
                            left_hand, right_hand = pointing_hands[0], pointing_hands[1]
                        else:
                            left_hand, right_hand = pointing_hands[1], pointing_hands[0]
                            
                        # Left hand anchors, right hand draws
                        l_ix, l_iy = int(left_hand[8].x * w_img), int(left_hand[8].y * h_img)
                        l_mx, l_my = int(left_hand[12].x * w_img), int(left_hand[12].y * h_img)
                        anchor_point = ((l_ix + l_mx) // 2, (l_iy + l_my) // 2)
                        
                        r_ix, r_iy = int(right_hand[8].x * w_img), int(right_hand[8].y * h_img)
                        r_mx, r_my = int(right_hand[12].x * w_img), int(right_hand[12].y * h_img)
                        draw_point = ((r_ix + r_mx) // 2, (r_iy + r_my) // 2)
                        
                        # Add a core bright spot at the fingers
                        cv2.circle(frame, anchor_point, 10, (50, 150, 255), -1) # Anchor glow
                        cv2.circle(frame, draw_point, 10, (150, 255, 255), -1)  # Draw glow
                        cv2.circle(frame, draw_point, 20, (0, 150, 255), 4)
                        
                        sling_ring_trail.append(draw_point)
                        
                        # Detect Circle Completion (loop closure) to open Portal
                        if len(sling_ring_trail) > 40 and not portal_open:
                            start_pt = sling_ring_trail[0]
                            dist_to_start = math.hypot(draw_point[0] - start_pt[0], draw_point[1] - start_pt[1])
                            if dist_to_start < 100: # Closed the loop
                                portal_open = True
                                # Calculate center of the drawn trail
                                t_xs = [pt[0] for pt in sling_ring_trail]
                                t_ys = [pt[1] for pt in sling_ring_trail]
                                portal_center = (sum(t_xs)//len(t_xs), sum(t_ys)//len(t_ys))
                        
                        # Spawn realistic movie-style sparks (High Density)
                        for _ in range(40): # Emit many sparks per frame
                            # Sparks shoot outwards in a circular spray
                            angle = random.uniform(0, math.pi * 2)
                            # Intense initial burst speed
                            speed = random.uniform(5, 30) 
                            vx = math.cos(angle) * speed
                            vy = math.sin(angle) * speed
                            
                            # Random lifespan
                            life = random.uniform(0.2, 0.9)
                            
                            # Size variation
                            thickness = random.choice([1, 1, 1, 2, 2, 3]) 
                            
                            sling_ring_sparks.append([draw_point[0], draw_point[1], vx, vy, thickness, life, life])
                        
                        
                    # ---------------------------------------------------------
                    # SPELL 4: TIME STONE (Open Palm, Ghosting)
                    # ---------------------------------------------------------
                    elif current_mode == MODE_TIME_STONE and is_open_palm(hand_landmarks):
                        active_time_stone_hand = True
                        palm_center = hand_landmarks[9]
                        cx, cy = int(palm_center.x * w_img), int(palm_center.y * h_img)
                        target_size = int(math.hypot(cx - wx, cy - wy) * 3.5)
                        
                        if target_size > 10:
                            velocity = math.hypot(cx - prev_cx, cy - prev_cy) if prev_cx else 0
                            prev_cx, prev_cy = cx, cy
                            
                            kinetic_angle = current_angle + (velocity * 0.5)
                            
                            scaled_circle = cv2.resize(spell_assets[MODE_TIME_STONE], (target_size, target_size), interpolation=cv2.INTER_AREA)
                            rotated = rotate_image(scaled_circle, kinetic_angle)
                            frame = overlay_transparent(frame, rotated, cx - target_size//2, cy - target_size//2)
                            
                            trail_deque.append((rotated, cx - target_size//2, cy - target_size//2))

            # Sling Ring Rendering (Procedural Additive Vortex)
            if current_mode == MODE_SLING_RING:
                # Black canvas for Additive Blending magic glow
                blanket = np.zeros_like(frame)
                
                # 0. Draw the Fiery Trail
                if len(sling_ring_trail) > 1:
                    for k in range(1, len(sling_ring_trail)):
                        pt1 = sling_ring_trail[k-1]
                        pt2 = sling_ring_trail[k]
                        thickness = max(1, int((k / len(sling_ring_trail)) * 25))
                        cv2.line(blanket, pt1, pt2, (0, 100, 255), thickness + 15, cv2.LINE_AA) 
                        cv2.line(blanket, pt1, pt2, (100, 220, 255), thickness + 5, cv2.LINE_AA) 
                        cv2.line(blanket, pt1, pt2, (255, 255, 255), max(1, thickness - 3), cv2.LINE_AA)
                
                # 1. Spawn portal vortex particles
                if portal_open:
                    portal_scale = min(1.0, portal_scale + 1.0 * dt) 
                    
                    if portal_scale > 0.2:
                        for _ in range(30): 
                            angle = random.uniform(0, math.pi * 2)
                            radius = random.uniform(30, 250 * portal_scale)
                            sx = portal_center[0] + radius * math.cos(angle)
                            sy = portal_center[1] + radius * math.sin(angle)
                            
                            speed_multiplier = portal_scale * 30
                            vx = -math.sin(angle) * speed_multiplier * 1.5 + math.cos(angle) * speed_multiplier * 0.2
                            vy =  math.cos(angle) * speed_multiplier * 1.5 + math.sin(angle) * speed_multiplier * 0.2
                            
                            life = random.uniform(0.3, 1.5)
                            thickness = random.choice([1, 2, 2, 3])
                            sling_ring_sparks.append([sx, sy, vx, vy, thickness, life, life, 0])
                            
                        # Floating Runes / Rock Debris
                        if random.random() < 0.25:
                            angle = random.uniform(0, math.pi * 2)
                            radius = random.uniform(100, 280 * portal_scale)
                            sx = portal_center[0] + radius * math.cos(angle)
                            sy = portal_center[1] + radius * math.sin(angle)
                            vx = -math.sin(angle) * 20
                            vy =  math.cos(angle) * 20
                            life = random.uniform(1.0, 2.5)
                            sling_ring_sparks.append([sx, sy, vx, vy, -1, life, life, random.uniform(0, 360)])
                    
                # 2. Render Falling & Swirling Sparks
                new_sparks = []
                for s in sling_ring_sparks:
                    if len(s) == 7: s.append(0)
                        
                    x, y, vx, vy, thickness, life, max_life, rot = s
                    
                    if thickness == -1:
                        x += vx * dt * 30
                        y += vy * dt * 30
                        rot += 150 * dt 
                        life -= dt
                        if life > 0:
                            new_sparks.append([x, y, vx, vy, thickness, life, max_life, rot])
                            size = int(6 * (life/max_life) * (portal_scale if portal_scale > 0 else 1))
                            if size > 1:
                                pts = cv2.ellipse2Poly((int(x), int(y)), (size, int(size*1.5)), int(rot), 0, 360, 60)
                                cv2.fillPoly(blanket, [pts], (80, 150, 200))
                    else:
                        px, py = x, y 
                        x += vx * dt * 30
                        y += vy * dt * 30
                        
                        if not portal_open:
                            vy += 40.0 * dt  
                            vx *= 0.95       
                            vy *= 0.98       
                        
                        life -= dt
                        if life > 0:
                            new_sparks.append([x, y, vx, vy, thickness, life, max_life, rot])
                            
                            life_ratio = life / max_life
                            if life_ratio > 0.8: color = (255, 255, 255) 
                            elif life_ratio > 0.5: color = (100, 220, 255) 
                            elif life_ratio > 0.2: color = (0, 165, 255) 
                            else: color = (0, 0, int(255 * (life_ratio / 0.2)))
                            
                            streak_multiplier = 1.5 if not portal_open else 0.5
                            end_x = int(x - vx * streak_multiplier)
                            end_y = int(y - vy * streak_multiplier)
                            cv2.line(blanket, (int(px), int(py)), (end_x, end_y), color, thickness, cv2.LINE_AA)
                            
                            if life_ratio > 0.3:
                                cv2.circle(blanket, (int(x), int(y)), 1, (255, 255, 255), -1)

                sling_ring_sparks = new_sparks
                frame = cv2.add(frame, blanket)

            # Time Stone Afterimage Rendering
            if current_mode == MODE_TIME_STONE:
                if not active_time_stone_hand:
                    prev_cx, prev_cy = None, None
                    trail_deque.clear()
                    
                for idx, (ghost_img, tx, ty) in enumerate(trail_deque):
                    if idx < len(trail_deque) - 1: # Don't re-render the current frame
                        opacity_factor = (idx + 1) / len(trail_deque)
                        ghost_copy = ghost_img.copy()
                        ghost_copy[:, :, 3] = (ghost_copy[:, :, 3] * (opacity_factor * 0.4)).astype(np.uint8)
                        frame = overlay_transparent(frame, ghost_copy, tx, ty)

            cv2.imshow("Doctor Strange AR", frame)

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
