import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="0c04a093-bbe4-4a85-94eb-a170eaab8c5f",
    name="Verify Room Accessibility and Front Door Presence",
    tc_id="TC-30",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"reachable_rooms_fraction": "11/11", "unreachable_rooms_findings": "[]", "floor_2_unreachable_rooms": "[]", "front_door_drawn_check": "true", "reachable_rooms_equal_total_check": "true"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='333865f3-8034-4f6d-9945-42716ab8fac4'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('Reading the reachable rooms fraction from the status bar'):
        set_var('reachable_rooms_fraction', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {101: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(101).textContent.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:testid=[data-testid="status-reachable"s]'], query='the fraction next to Rooms reachable in the bottom status bar', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='the fraction next to Rooms reachable in the status bar along the bottom of the screen is saved as {{reachable_rooms_fraction}}'))
    
    async with testmu.step('Extracting unreachable-room findings from the findings panel'):
        set_var('unreachable_rooms_findings', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {91: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(91).querySelectorAll('[data-testid]')).map(e=>e.textContent.trim()).filter(t=>/cannot be reached/i.test(t))));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:role=complementary >> internal:has-text="FindingsLedgerNothing"i'], query='every right findings panel finding that says a room cannot be reached, including its room name', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='every finding in the right findings panel that says a room cannot be reached, with the room name it gives, is saved as {{unreachable_rooms_findings}}'))
    
    async with testmu.step('Clicking the Floor 2 tab', instruction_id='aafa9bef-5700-43a1-8235-3f0b33439a52'):
        _loc_1 = page.locator("internal:testid=[data-testid=\"storey-1\"s]")
        
        await _loc_1.click()
    
    async with testmu.step('Reading unreachable Floor 2 rooms from the findings panel'):
        set_var('floor_2_unreachable_rooms', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {96: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(96).innerText.includes('Nothing found') ? '[]' : null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:text="FindingsLedgerNothing"i'], query='the list of Floor 2 rooms that cannot be reached in the findings panel', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='any room on Floor 2 in the findings panel that cannot be reached is saved as {{floor_2_unreachable_rooms}}'))
    
    async with testmu.step('Clicking Ground floor tab', instruction_id='c34c5cd0-e48a-4b11-8a1a-7dde96e0fb0c'):
        _loc_2 = page.locator("internal:testid=[data-testid=\"storey-0\"s]")
        
        await _loc_2.click()
    
    async with testmu.step('whether a front door drawn on the drawing, as an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc is present (on the ground-floor drawing)', instruction_id='37e91072-753a-4b6d-9254-0454d071a68b'):
        set_var('front_door_drawn_check', await testmu.vision_query(page, "whether a front door drawn on the drawing, as an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc is present (on the ground-floor drawing)", ""))
    
    async with testmu.step('Checking the reachable and total room counts in the status bar'):
        set_var('reachable_rooms_equal_total_check', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {101: 0};\n  const el = (i) => els[__m[i]];\n  const __v = ((() => { const m = el(101).textContent.trim().match(/^(\\d+)\\s*\\/\\s*(\\d+)$/); return !!m && m[1] === m[2]; })());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:testid=[data-testid="status-reachable"s]'], query='whether the reachable room count equals the total room count in the status bar', expected_value='true', needs_unit_conversion=False, operator='equals', transforms=[], condition='the number of reachable rooms equals the total number of rooms shown in the status bar'))
    
    async with testmu.step('Assertion check', instruction_id='a1371d3c-6aaa-4522-9868-93320c37f245'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'there is a front door drawn on the drawing: an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{front_door_drawn_check}}', 'store_key': 'front_door_drawn_check', 'variable_refs': {'{{front_door_drawn_check}}': 'true'}}], 'sub_checks': [{'description': 'there is a front door drawn on the drawing: an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc', 'store_key': 'front_door_drawn_check', 'expected_value': 'true', 'extracted_value': '{{front_door_drawn_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'there is a front door drawn on the drawing: an opening on the bottom, street-facing wall of the building, marked as a door with a swing arc'})
    
    async with testmu.step('Assertion check', instruction_id='41aadd68-23eb-4e91-bfd2-63a1ecb8e1f4'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the number of reachable rooms equals the total number of rooms shown in the status bar', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{reachable_rooms_equal_total_check}}', 'store_key': 'reachable_rooms_equal_total_check', 'variable_refs': {'{{reachable_rooms_equal_total_check}}': 'true'}}], 'sub_checks': [{'description': 'the number of reachable rooms equals the total number of rooms shown in the status bar', 'store_key': 'reachable_rooms_equal_total_check', 'expected_value': 'true', 'extracted_value': '{{reachable_rooms_equal_total_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the number of reachable rooms equals the total number of rooms shown in the status bar'})


if __name__ == "__main__":
    testmu.run(test)