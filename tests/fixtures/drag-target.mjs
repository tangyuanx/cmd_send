// Use actual Chromium pointer events rather than a synthetic long press.
export async function dragTarget(page){
  const box=await page.locator('#targetButton').boundingBox();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+12,y);await page.mouse.up();
}
