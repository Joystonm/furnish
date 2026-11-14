import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="f8d07a91-7d7c-4cc0-bdd9-799d5c4b126e",
    name="Verify Room Accessibility and Front Door Presence",
    tc_id="TC-29",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"reachable_fraction": "11/11", "unreachable_rooms": "[]", "reachable_rooms_total_check": "true", "front_door_drawn_check": "false"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='c94575a1-448f-4bf5-ba1e-fd9eaebd7f2c'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('Reading the Rooms reachable fraction from the status bar'):
        set_var('reachable_fraction', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {101: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(101).textContent.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:testid=[data-testid="status-reachable"s]'], query='the Rooms reachable fraction in the bottom status bar', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='Get the fraction next to Rooms reachable in the status bar along the bottom of the screen and save it as {{reachable_fraction}}.'))
    
    async with testmu.step('Extracting unreachable-room findings from the findings panel'):
        set_var('unreachable_rooms', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {92: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(92).querySelectorAll('*')).map(n=>n.innerText||'').filter(t=>/cannot be reached/i.test(t)).map(t=>{const m=t.match(/(?:room\\s*[:#-]?\\s*)?([^\\n.]+?)\\s+cannot be reached/i)||t.match(/cannot be reached[^\\n]*?(?:room\\s*[:#-]?\\s*)([^\\n.]+)/i);return m?m[1].trim():t.trim()}).filter((v,i,a)=>v&&a.indexOf(v)===i)));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:text="FindingsLedgerNothing"i'], query='every finding in the right-side findings panel that reports a room cannot be reached, including its room name', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='Get every finding in the findings panel on the right that says a room cannot be reached, with the room name it gives, and save it as {{unreachable_rooms}}.'))
    
    async with testmu.step('Clicking the Floor 2 tab', instruction_id='ea7047d5-ad9d-4379-8725-4745e771cea6'):
        _loc_1 = page.locator("internal:testid=[data-testid=\"storey-1\"s]")
        
        await _loc_1.click()
    
    async with testmu.step('Checking whether the reachable-room count equals the total-room count'):
        set_var('reachable_rooms_total_check', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {105: 0};\n  const el = (i) => els[__m[i]];\n  const __v = ((() => { const m = (el(105).textContent || '').trim().match(/^(\\d+)\\s*\\/\\s*(\\d+)$/); return !!m && Number(m[1]) === Number(m[2]); })());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:testid=[data-testid="status-reachable"s]'], query='whether the reachable-room count equals the total-room count', expected_value='true', needs_unit_conversion=False, operator='equals', transforms=[], condition='The number of reachable rooms equals the total number of rooms shown in the status bar.'))
    
    async with testmu.step('whether a front door drawn on the drawing as an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc is present (on the displayed floor-plan drawing)', instruction_id='12f3a32c-65f6-4d24-a3e6-da444e30fc61'):
        set_var('front_door_drawn_check', await testmu.vision_query(page, "whether a front door drawn on the drawing as an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc is present (on the displayed floor-plan drawing)", ""))


if __name__ == "__main__":
    testmu.run(test)