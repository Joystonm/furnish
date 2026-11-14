import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="b3d12cd7-b696-4701-b4f1-e977a6e45216",
    name="Identify Furniture Blocking Doorways",
    tc_id="TC-31",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"furniture_rectangles_clear_of_door_floor": "true", "doorway_blocking_finding_absent": "false", "doorway_blocking_findings": "[]"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='03242c61-b7e2-4f05-88db-fd43a0d49c1b'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('Clicking the Floor 2 tab', instruction_id='0cd4dfa6-a5cf-42aa-a354-9be0a2ba0cf9'):
        _loc_1 = page.locator("internal:testid=[data-testid=\"storey-1\"s]")
        
        await _loc_1.click()
    
    async with testmu.step('whether furniture rectangles clear of the floor immediately in front of one door, on the room side is present (on the floor plan)', instruction_id='02510d68-652e-4b4d-8f45-291762ab24b5'):
        set_var('furniture_rectangles_clear_of_door_floor', await testmu.vision_query(page, "whether furniture rectangles clear of the floor immediately in front of one door, on the room side is present (on the floor plan)", ""))
    
    async with testmu.step('Assertion check', instruction_id='14e06482-e9c7-4e9b-a441-76b202420f64'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the furniture rectangles are clear of the floor immediately in front of one door, on the room side', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{furniture_rectangles_clear_of_door_floor}}', 'store_key': 'furniture_rectangles_clear_of_door_floor', 'variable_refs': {'{{furniture_rectangles_clear_of_door_floor}}': 'true'}}], 'sub_checks': [{'description': 'the furniture rectangles are clear of the floor immediately in front of one door, on the room side', 'store_key': 'furniture_rectangles_clear_of_door_floor', 'expected_value': 'true', 'extracted_value': '{{furniture_rectangles_clear_of_door_floor}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the furniture rectangles are clear of the floor immediately in front of one door, on the room side'})
    
    async with testmu.step('Checking for doorway-blocking furniture findings'):
        set_var('doorway_blocking_finding_absent', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {96: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (/(?:\\bblocks?\\b|\\bblocking\\b).*\\bdoorway\\b|\\bdoorway\\b.*(?:\\bblocks?\\b|\\bblocking\\b)/i.test(el(96).innerText));\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:text="FindingsLedgerNothing"i'], query='whether a finding anywhere that says a piece of furniture blocks a doorway is present (in the Findings panel)', expected_value='false', needs_unit_conversion=False, operator='equals', transforms=[], condition='there is no finding anywhere that says a piece of furniture blocks a doorway'))
    
    async with testmu.step('Extracting doorway-blocking furniture findings'):
        set_var('doorway_blocking_findings', await testmu.textual_analyzer(page, wrapped_js='(els) => {\n  const __m = {96: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (JSON.stringify(Array.from(el(96).querySelectorAll(\'li,[role="listitem"],article\')).map(n=>n.innerText).filter(t=>/(?:\\bblocks?\\b|\\bblocking\\b).*\\bdoorway\\b|\\bdoorway\\b.*(?:\\bblocks?\\b|\\bblocking\\b)/i.test(t))));\n  return (typeof __v === \'boolean\' ? String(__v) : __v);\n}', locators=['internal:text="FindingsLedgerNothing"i'], query='every Findings panel entry that says a piece of furniture blocks a doorway, including its furniture and room', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='every finding that says a piece of furniture blocks a doorway, including the piece of furniture it names and the room it is in, is saved as {{doorway_blocking_findings}}'))
    
    async with testmu.step('Assertion check', instruction_id='7508fe2a-e373-48f6-b334-4907b0c8a07d'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'there is no finding anywhere that says a piece of furniture blocks a doorway', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'false', 'extracted_value': '{{doorway_blocking_finding_absent}}', 'store_key': 'doorway_blocking_finding_absent', 'variable_refs': {'{{doorway_blocking_finding_absent}}': 'false'}}], 'sub_checks': [{'description': 'there is no finding anywhere that says a piece of furniture blocks a doorway', 'store_key': 'doorway_blocking_finding_absent', 'expected_value': 'false', 'extracted_value': '{{doorway_blocking_finding_absent}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'there is no finding anywhere that says a piece of furniture blocks a doorway'})


if __name__ == "__main__":
    testmu.run(test)