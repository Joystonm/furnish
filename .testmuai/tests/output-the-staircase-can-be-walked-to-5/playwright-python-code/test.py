import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="ec7a3d4f-affc-4922-bd30-8e495139bb16",
    name="Verify Staircase Door and Accessibility",
    tc_id="TC-43",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"staircase_door_drawn_check": "true", "staircase_finding": "Nothing found\nEvery room has a door, every door can be reached, and nothing is standing in a doorway.", "staircase_floor_2_drawn_check": "true", "staircase_door_status": "true", "staircase_storey_presence": "true", "stair_usability": "true"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='8b247b8c-973e-4338-8698-3c56647e13a9'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('Clicking the Ground floor tab', instruction_id='b7d39291-ad91-4d50-ae71-b021ef005fc8'):
        _loc_1 = page.locator("internal:testid=[data-testid=\"storey-0\"s]")
        
        await _loc_1.click()
    
    async with testmu.step('whether a door drawn into the staircase is present (in the ground-floor stair well)', instruction_id='2981f782-bf21-42ac-abe2-0cf779ec920f'):
        set_var('staircase_door_drawn_check', await testmu.vision_query(page, "whether a door drawn into the staircase is present (in the ground-floor stair well)", ""))
    
    async with testmu.step('Assertion check', instruction_id='6995cc4e-8c8b-40e2-a4b8-27991cf92ae5'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{staircase_door_drawn_check}}', 'store_key': 'staircase_door_drawn_check', 'variable_refs': {'{{staircase_door_drawn_check}}': 'true'}}], 'sub_checks': [{'description': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc', 'store_key': 'staircase_door_drawn_check', 'expected_value': 'true', 'extracted_value': '{{staircase_door_drawn_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc'})
    
    async with testmu.step('Reading the staircase finding from the Findings panel'):
        set_var('staircase_finding', await testmu.textual_analyzer(page, wrapped_js="(els) => {\n  const __m = {91: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (([...(el(91).querySelectorAll('*'))].find(e => e.innerText === 'Nothing found\\nEvery room has a door, every door can be reached, and nothing is standing in a doorway.') || null)?.innerText ?? null);\n  return (typeof __v === 'boolean' ? String(__v) : __v);\n}", locators=['internal:role=complementary >> internal:has-text="FindingsLedgerNothing"i'], query='the finding about the staircase in the Findings panel', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='any finding about the staircase from the findings panel on the right is stored as {{staircase_finding}}'))
    
    async with testmu.step('Clicking the Floor 2 tab', instruction_id='bd85fcf8-1f07-4ebd-b1f6-258340ca48d3'):
        _loc_2 = page.locator("internal:testid=[data-testid=\"storey-1\"s]")
        
        await _loc_2.click()
    
    async with testmu.step('Checking whether the staircase arriving at Floor 2 is present'):
        set_var('staircase_floor_2_drawn_check', await testmu.textual_analyzer(page, wrapped_js='(els) => {\n  const __m = {82: 0};\n  const el = (i) => els[__m[i]];\n  const __v = (el(82).querySelector(\'[data-testid="plan-stair-arriving"]\') !== null);\n  return (typeof __v === \'boolean\' ? String(__v) : __v);\n}', locators=['internal:testid=[data-testid="plan-svg"s]'], query='whether the staircase drawn on Floor 2 as the flight arriving at that level is present (in the Floor 2 floor plan)', expected_value='true', needs_unit_conversion=False, operator='equals', transforms=[], condition='the staircase is drawn on Floor 2 too, as the flight arriving at that level'))
    
    async with testmu.step('Assertion check', instruction_id='e9d4599b-4ecf-4a0d-9233-6d4fff6b7f29'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the staircase is drawn on Floor 2 too, as the flight arriving at that level', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{staircase_floor_2_drawn_check}}', 'store_key': 'staircase_floor_2_drawn_check', 'variable_refs': {'{{staircase_floor_2_drawn_check}}': 'true'}}], 'sub_checks': [{'description': 'the staircase is drawn on Floor 2 too, as the flight arriving at that level', 'store_key': 'staircase_floor_2_drawn_check', 'expected_value': 'true', 'extracted_value': '{{staircase_floor_2_drawn_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the staircase is drawn on Floor 2 too, as the flight arriving at that level'})
    
    async with testmu.step('whether the staircase has a door into it is stored as {{staircase_door_status}}', instruction_id='6b1eebe1-ebf6-4d1b-afcd-1e178f7df36c'):
        set_var('staircase_door_status', await testmu.vision_query(page, "whether the staircase has a door into it is stored as {{staircase_door_status}}", ""))
    
    async with testmu.step('whether the staircase is drawn on both storeys is stored as {{staircase_storey_presence}}', instruction_id='4c2863be-d3f7-400d-9908-69d38b2b93cc'):
        set_var('staircase_storey_presence', await testmu.vision_query(page, "whether the staircase is drawn on both storeys is stored as {{staircase_storey_presence}}", ""))
    
    async with testmu.step('whether the stair is usable is stored as {{stair_usability}}', instruction_id='450aa9fb-4415-40ba-a26f-8759a6f9507f'):
        set_var('stair_usability', await testmu.vision_query(page, "whether the stair is usable is stored as {{stair_usability}}", ""))


if __name__ == "__main__":
    testmu.run(test)