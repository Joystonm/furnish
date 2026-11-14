import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="a1362177-1af0-4a7b-99bb-4175c68e6628",
    name="Verify All Rooms Have Doors",
    tc_id="TC-28",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"room_no_door_finding": "false", "rooms_reachable": "11/11", "error_count": "0", "rooms_without_doors": "[]"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='f8efebbb-5cbe-40b5-be0a-55a7f75301cf'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('Clicking the Floor 2 tab', instruction_id='51d88d71-f93e-4380-bd9c-23b18acd24bb'):
        _loc_1 = page.locator("internal:testid=[data-testid=\"storey-1\"s]")
        
        await _loc_1.click()
    
    async with testmu.step('Waiting for confirming the Floor 2 findings panel has been read', instruction_id='1fc3f764-a58c-4aca-9349-d47db0596ea5'):
        await page.wait_for_timeout(100)
    
    async with testmu.step('whether a finding that says a room has no door is present (in the Findings panel)', instruction_id='43be5f1e-7c6b-4c6e-b154-6ab6e1a6bcf1'):
        set_var('room_no_door_finding', await testmu.vision_query(page, "whether a finding that says a room has no door is present (in the Findings panel)", ""))
    
    async with testmu.step('Reading reachable rooms from the status bar'):
        set_var('rooms_reachable', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {105: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(105).textContent.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:testid=[data-testid="status-reachable"s]'], query='the number next to Rooms reachable in the bottom status bar', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='the number next to Rooms reachable in the status bar along the bottom of the screen is saved as {{rooms_reachable}}'))
    
    async with testmu.step('Reading errors from the status bar'):
        set_var('error_count', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {106: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(106).textContent.trim());\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:testid=[data-testid="status-errors"s]'], query='the number next to errors in the bottom status bar', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='the number next to errors in the status bar along the bottom of the screen is saved as {{error_count}}'))
    
    async with testmu.step('Reading room names from no-door findings'):
        set_var('rooms_without_doors', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {1: 0};\n  const el = (i) => els[__m[i]];\n  const __v = ((/no findings/i.test(el(1).textContent||'')) ? '[]' : null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:text="Furnish Verifieda plan that has been walkedno findings"i'], query='the room names named in findings that say a room has no door', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='every room name named in a finding that says a room has no door is saved as {{rooms_without_doors}}'))
    
    async with testmu.step('Assertion check', instruction_id='b2dae556-8aa7-49bc-b3ef-e1073fc2c989'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'no finding anywhere says a room has no door', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'false', 'extracted_value': '{{room_no_door_finding}}', 'store_key': 'room_no_door_finding', 'variable_refs': {'{{room_no_door_finding}}': 'false'}}], 'sub_checks': [{'description': 'no finding anywhere says a room has no door', 'store_key': 'room_no_door_finding', 'expected_value': 'false', 'extracted_value': '{{room_no_door_finding}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'no finding anywhere says a room has no door'})


if __name__ == "__main__":
    testmu.run(test)