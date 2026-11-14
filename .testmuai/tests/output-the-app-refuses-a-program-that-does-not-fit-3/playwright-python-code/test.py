import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="96ad0d4c-a722-47d0-9b76-6e4f5ec8400f",
    name="Validate Plot Fit Refusal and Plan Generation",
    tc_id="TC-37",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"red_refusal_box_shown": "true", "refusal_area_detail_line": "true", "nonfitting_rooms_drawing": "false", "drawing_returned": "true"},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='5c4bdbf7-5c02-4304-8ac4-897c90a50690'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('Typing 6 into Plot width in metres field', instruction_id='d4134e94-f461-4e9f-93e7-671eac050cda'):
        element_0 = page.locator("internal:testid=[data-testid=\"plot-width\"s]")
        
        await testmu.fill(element_0, "6")
    
    async with testmu.step('Waiting while the plan generates', instruction_id='c0fbcb43-377c-4922-a471-edcff44b3138'):
        await page.wait_for_timeout(1000)
    
    async with testmu.step('Type "5" into "Plot depth in metres"', instruction_id='e9ac5a44-b2ea-4c2b-9d43-b2eb856a547a'):
        element_1 = page.locator("internal:testid=[data-testid=\"plot-depth\"s]")
        
        await testmu.fill(element_1, "5")
    
    async with testmu.step('Click "Generate the plan"', instruction_id='1840436c-65ac-4d39-a124-d287fba5dd7a'):
        _loc_1 = page.locator("internal:testid=[data-testid=\"generate\"s]")
        
        await _loc_1.click()
    
    async with testmu.step('whether a red box saying the program does not fit the plot is present (in the left brief panel)', instruction_id='de87a704-2efd-447d-b817-d3107dace47d'):
        set_var('red_refusal_box_shown', await testmu.vision_query(page, "whether a red box saying the program does not fit the plot is present (in the left brief panel)", ""))
    
    async with testmu.step('whether a detail line giving the area asked for and the area the plot holds is present (in the red plot-refusal box)', instruction_id='b083dd09-cf1c-4da7-a0f5-001fe7df6425'):
        set_var('refusal_area_detail_line', await testmu.vision_query(page, "whether a detail line giving the area asked for and the area the plot holds is present (in the red plot-refusal box)", ""))
    
    async with testmu.step('whether a drawing of rooms that do not fit in the canvas in the middle is present (in the middle canvas)', instruction_id='833acc30-3945-401e-b100-2169f22a23bd'):
        set_var('nonfitting_rooms_drawing', await testmu.vision_query(page, "whether a drawing of rooms that do not fit in the canvas in the middle is present (in the middle canvas)", ""))
    
    async with testmu.step('Assertion check', instruction_id='77cbb0e0-d557-44d9-a20b-6d80768bd553'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'A red box saying the program does not fit the plot is shown.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{red_refusal_box_shown}}', 'store_key': 'red_refusal_box_shown', 'variable_refs': {'{{red_refusal_box_shown}}': 'true'}}, {'description': 'A detail line gives the area asked for and the area the plot holds.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{refusal_area_detail_line}}', 'store_key': 'refusal_area_detail_line', 'variable_refs': {'{{refusal_area_detail_line}}': 'true'}}], 'sub_checks': [{'description': 'A red box saying the program does not fit the plot is shown.', 'store_key': 'red_refusal_box_shown', 'expected_value': 'true', 'extracted_value': '{{red_refusal_box_shown}}', 'operator': 'equals', 'transforms': []}, {'description': 'A detail line gives the area asked for and the area the plot holds.', 'store_key': 'refusal_area_detail_line', 'expected_value': 'true', 'extracted_value': '{{refusal_area_detail_line}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'A refusal is shown: a red box saying the program does not fit the plot, with a detail line that gives the area asked for and the area the plot holds.'})
    
    async with testmu.step('Assertion check', instruction_id='9d7af62d-5c15-4eee-97c9-dea6b331237b'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'false', 'extracted_value': '{{nonfitting_rooms_drawing}}', 'store_key': 'nonfitting_rooms_drawing', 'variable_refs': {'{{nonfitting_rooms_drawing}}': 'false'}}], 'sub_checks': [{'description': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.', 'store_key': 'nonfitting_rooms_drawing', 'expected_value': 'false', 'extracted_value': '{{nonfitting_rooms_drawing}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.'})
    
    async with testmu.step('Waiting for the plan to generate', instruction_id='a930a62e-3d38-465f-94ec-661cd33d9e46'):
        await page.wait_for_timeout(1000)
    
    async with testmu.step('Type "18" into "Plot width in metres"', instruction_id='8a0e28cd-b412-4e20-a5d6-5ed426b8c88b'):
        element_2 = page.locator("internal:testid=[data-testid=\"plot-width\"s]")
        
        await testmu.fill(element_2, "18")
    
    async with testmu.step('Type "14" into "Plot depth in metres"', instruction_id='af6f6997-6f34-4918-8ffb-bca6abc81e5b'):
        element_3 = page.locator("internal:testid=[data-testid=\"plot-depth\"s]")
        
        await testmu.fill(element_3, "14")
    
    async with testmu.step('Click "Generate the plan"', instruction_id='c6193eb4-7551-4b43-a5e3-3a951e06da9e'):
        _loc_2 = page.locator("internal:testid=[data-testid=\"generate\"s]")
        
        await _loc_2.click()
    
    async with testmu.step('whether a drawing in the canvas in the middle is present (in the middle canvas)', instruction_id='3390e6a4-365a-4482-a0ae-33d7dd233750'):
        set_var('drawing_returned', await testmu.vision_query(page, "whether a drawing in the canvas in the middle is present (in the middle canvas)", ""))
    
    async with testmu.step('Assertion check', instruction_id='b8bbf703-66b8-482b-8824-61cae6cb684d'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'A drawing comes back.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{drawing_returned}}', 'store_key': 'drawing_returned', 'variable_refs': {'{{drawing_returned}}': 'true'}}], 'sub_checks': [{'description': 'A drawing comes back.', 'store_key': 'drawing_returned', 'expected_value': 'true', 'extracted_value': '{{drawing_returned}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'A drawing comes back.'})


if __name__ == "__main__":
    testmu.run(test)