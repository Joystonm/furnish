import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="582b7f37-10a0-49bf-b5b7-fc89de99fd41",
    name="Verify Staircase Door and Accessibility",
    tc_id="TC-41",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"staircase_door_drawn_check": "true", "staircase_finding": "Nothing found", "staircase_floor_2_drawn_check": "true", "stair_usability": "true", "staircase_door_status": "true"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='0f3e2280-1db2-4283-a86f-0a546ac949cc'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('Clicking the Ground floor tab', instruction_id='23640e4a-4ea0-44d3-bbd7-ccbfd80321bf'):
        _loc_1 = page.locator("internal:testid=[data-testid=\"storey-0\"s]")
        
        await _loc_1.click()
    
    async with testmu.step('whether a door drawn into the staircase is present (in the stair well on the ground-floor plan)', instruction_id='4108d2b1-d404-4b98-8713-027186ab9a00'):
        set_var('staircase_door_drawn_check', await testmu.vision_query(page, "whether a door drawn into the staircase is present (in the stair well on the ground-floor plan)", ""))
    
    async with testmu.step('Assertion check', instruction_id='cde315c2-745d-4dbf-8e9e-22a49306ed2b'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{staircase_door_drawn_check}}', 'store_key': 'staircase_door_drawn_check', 'variable_refs': {'{{staircase_door_drawn_check}}': 'true'}}], 'sub_checks': [{'description': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc', 'store_key': 'staircase_door_drawn_check', 'expected_value': 'true', 'extracted_value': '{{staircase_door_drawn_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'a door is drawn into the staircase, that is, an opening in a wall of the stair well with a swing arc'})
    
    async with testmu.step('Reading the findings panel on the right and recording staircase findings', instruction_id='2fce9789-68e1-4929-8ff1-4c59cba9f943'):
        await page.wait_for_timeout(1000)
    
    async with testmu.step('any finding about the staircase from the findings panel on the right is saved as {{staircase_finding}}', instruction_id='479a182c-4ab9-4b43-ac7a-13ff692abb84'):
        set_var('staircase_finding', await testmu.vision_query(page, "any finding about the staircase from the findings panel on the right is saved as {{staircase_finding}}", ""))
    
    async with testmu.step('Clicking the Floor 2 tab', instruction_id='c090f6db-21b6-457a-bfa2-bebd8be52919'):
        _loc_2 = page.locator("internal:testid=[data-testid=\"storey-1\"s]")
        
        await _loc_2.click()
    
    async with testmu.step('whether the staircase drawn on Floor 2 as the flight arriving at that level is present (in the Floor 2 floor plan)', instruction_id='d0954dec-50a4-4593-af0c-210ec4168777'):
        set_var('staircase_floor_2_drawn_check', await testmu.vision_query(page, "whether the staircase drawn on Floor 2 as the flight arriving at that level is present (in the Floor 2 floor plan)", ""))
    
    async with testmu.step('Assertion check', instruction_id='68b82dd5-6e36-4279-8d4e-4acb281ecd48'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'the staircase is drawn on Floor 2 too, as the flight arriving at that level', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{staircase_floor_2_drawn_check}}', 'store_key': 'staircase_floor_2_drawn_check', 'variable_refs': {'{{staircase_floor_2_drawn_check}}': 'true'}}], 'sub_checks': [{'description': 'the staircase is drawn on Floor 2 too, as the flight arriving at that level', 'store_key': 'staircase_floor_2_drawn_check', 'expected_value': 'true', 'extracted_value': '{{staircase_floor_2_drawn_check}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'the staircase is drawn on Floor 2 too, as the flight arriving at that level'})
    
    async with testmu.step('Reading stair usability from the drawing and findings panel'):
        set_var('stair_usability', await testmu.textual_analyzer(page, wrapped_js='(els) => {\n  const __m = {82: 0, 96: 1};\n  const el = (i) => els[__m[i]];\n  const __v = (!!el(82).querySelector(\'[data-testid="plan-stair-arriving"]\') && el(96).textContent.includes(\'Nothing found\') && el(96).textContent.includes(\'Every room has a door, every door can be reached\'));\n  return (typeof __v === \'boolean\' ? String(__v) : __v);\n}', locators=['internal:testid=[data-testid="plan-svg"s]', 'internal:text="FindingsLedgerNothing"i'], query='whether the stair is usable from the staircase drawing and findings panel', expected_value='', needs_unit_conversion=False, operator='equals', transforms=['strip'], condition='whether the stair is usable from the staircase drawing and findings panel is saved as {{stair_usability}}'))
    
    async with testmu.step('Clicking the Ground floor tab in the staircase door report', instruction_id='b08e3a52-fc8b-4efd-9365-ef2c487f14f2'):
        _loc_3 = page.locator("internal:testid=[data-testid=\"storey-0\"s]")
        
        await _loc_3.click()
    
    async with testmu.step('whether the staircase has a door into it from the Ground floor drawing is saved as {{staircase_door_status}}', instruction_id='6004c379-0272-40a7-81f0-3bc78247a1b1'):
        set_var('staircase_door_status', await testmu.vision_query(page, "whether the staircase has a door into it from the Ground floor drawing is saved as {{staircase_door_status}}", ""))
    
    async with testmu.step('Clicking Floor 2 tab for the both-storeys report', instruction_id='847ed695-7b40-4696-86db-75f9d5e1aa44'):
        _loc_4 = page.locator("internal:testid=[data-testid=\"storey-1\"s]")
        
        await _loc_4.click()


if __name__ == "__main__":
    testmu.run(test)