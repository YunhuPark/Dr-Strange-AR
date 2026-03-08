import sys
import re

def patch_main():
    with open("c:/Users/박윤후/Desktop/프로젝트/Dormammu/web/main.js", "r", encoding="utf-8") as f:
        content = f.read()
        
    # 1. Add reset logic to keydown
    content = content.replace(
        """        // Reset states
        mandalaMesh.visible = false;
        drawingTrail = [];
        portalOpen = false;
        portalScale = 0;
        
        // Kill all particles""",
        """        // Reset states
        mandalaMesh.visible = false;
        drawingTrail = [];
        portalOpen = false;
        portalScale = 0;
        timeStoneGroup.visible = false;
        tsGhosts.forEach(g => g.visible = false);
        timeStoneTrail = [];
        
        // Kill all particles"""
    )
    
    # 2. Add render loop logic for Time Stone
    time_stone_logic = """
    // ---------------------------------------------------------
    // MODE 3: TIME STONE
    // ---------------------------------------------------------
    if (currentMode === SPELL_TIME_STONE) {
        if (results.handLandmarks && results.handLandmarks.length > 0 && isOpenPalm(results.handLandmarks[0])) {
            const hand = results.handLandmarks[0];
            const pos = getOrthographicPosition(hand[9].x, hand[9].y);
            
            timeStoneGroup.position.copy(pos);
            timeStoneGroup.quaternion.copy(getHandQuaternion(hand));
            
            // Spin individual rings on local axes
            ring1.rotation.x += 0.05;
            ring1.rotation.y += 0.02;
            ring2.rotation.y -= 0.04;
            ring2.rotation.z += 0.03;
            ring3.rotation.x -= 0.06;
            ring3.rotation.z -= 0.01;
            
            const scale = 1.0 + (hand[9].z * -5.0); 
            timeStoneGroup.scale.set(Math.max(scale, 0.5), Math.max(scale, 0.5), Math.max(scale, 0.5));
            timeStoneGroup.visible = true;
            
            // Record Trail
            timeStoneTrail.unshift({ 
                pos: timeStoneGroup.position.clone(), 
                quat: timeStoneGroup.quaternion.clone(),
                scale: timeStoneGroup.scale.clone(),
                r1: ring1.rotation.clone(),
                r2: ring2.rotation.clone(),
                r3: ring3.rotation.clone()
            });
            if (timeStoneTrail.length > 15) timeStoneTrail.pop();
        } else {
            timeStoneGroup.visible = false;
        }
        
        // Render Ghosts
        for(let i=0; i<5; i++) {
            let trailIdx = i * 3 + 2; 
            if (trailIdx < timeStoneTrail.length) {
                let state = timeStoneTrail[trailIdx];
                tsGhosts[i].position.copy(state.pos);
                tsGhosts[i].quaternion.copy(state.quat);
                tsGhosts[i].scale.copy(state.scale);
                tsGhosts[i].children[0].rotation.copy(state.r1);
                tsGhosts[i].children[1].rotation.copy(state.r2);
                tsGhosts[i].children[2].rotation.copy(state.r3);
                
                // Fade opacity
                tsGhosts[i].children.forEach(c => c.material.opacity = 0.5 - (i * 0.1));
                tsGhosts[i].visible = true;
            } else {
                tsGhosts[i].visible = false;
            }
        }
    } else {
        timeStoneGroup.visible = false;
        tsGhosts.forEach(g => g.visible = false);
    }

    // Render Scene using post-processing bloom composer"""

    content = content.replace(
        "    // Render Scene using post-processing bloom composer",
        time_stone_logic
    )
    
    with open("c:/Users/박윤후/Desktop/프로젝트/Dormammu/web/main.js", "w", encoding="utf-8") as f:
        f.write(content)
        
if __name__ == "__main__":
    patch_main()
