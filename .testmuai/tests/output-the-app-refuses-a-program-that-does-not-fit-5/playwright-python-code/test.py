import os
import testmu
from testmu import expect, var, set_var
from playwright.async_api import Page

testmu.configure(
    build="245fbd98-cec2-494f-9833-f450763e7fa9",
    name="Validate Plot Fit Refusal and Plan Generation",
    tc_id="TC-39",
    network=os.getenv("NETWORK", "false").lower() == "true",
    variables={"program_fit_plot_condition": "false", "program_does_not_fit_refusal": "true", "refusal_area_detail_line": "true", "nonfitting_rooms_drawing": "false", "refusal_wording": "The program does not fit the plot", "refusal_area_numbers": "105.0 m\u00b2 requested; 12.0 m\u00b2 held", "drawing_returns": "true", "assertion_results": "Nothing found. Every room has a door, every door can be reached, and nothing is standing in a doorway."},
    auto_heal_version="AH2",
    default_action_timeout_ms=60000,
    default_navigation_timeout_ms=60000,
    kane_run_v4=True,
)

@testmu.test
async def test(page: Page):
    async with testmu.step('Navigate to http://localhost:5199', instruction_id='c837115f-81be-4976-b422-022854c7c1c9'):
        await page.goto("http://localhost:5199")
    
    async with testmu.step('whether the program fitting the plot is present (in the plan findings and plot view)', instruction_id='92db24e6-f73f-4afa-b2ee-a767a0685233'):
        set_var('program_fit_plot_condition', await testmu.vision_query(page, "whether the program fitting the plot is present (in the plan findings and plot view)", ""))
    if await testmu.evaluate_branch(sub_checks=[{'description': 'the program cannot fit the plot', 'store_key': 'program_fit_plot_condition', 'expected_value': 'false', 'stored_value': '{{program_fit_plot_condition}}', 'operator': 'equals', 'transforms': []}], composite_operator="and"):
        async with testmu.step('Waiting for the plan to finish generating', instruction_id='1b78fa47-883c-4340-b77e-166ca3af39c8'):
            await page.wait_for_timeout(1000)
        
        async with testmu.step('Type "6" into "Plot width in metres"', instruction_id='499d0c0e-37f6-4084-8487-6657cc61a4d3'):
            element_0 = page.locator("internal:testid=[data-testid=\"plot-width\"s]")
            
            await testmu.fill(element_0, "6")
        
        async with testmu.step('Type "5" into "Plot depth in metres"', instruction_id='a19593a2-1ba2-4794-a9ca-28a76e053c37'):
            element_1 = page.locator("internal:testid=[data-testid=\"plot-depth\"s]")
            
            await testmu.fill(element_1, "5")
        
        async with testmu.step('Click "Generate the plan"', instruction_id='f5a49a89-5c07-4ba1-8ebd-ca62fd295cb3'):
            _loc_1 = page.locator("internal:testid=[data-testid=\"generate\"s]")
            
            await _loc_1.click()
    
    async with testmu.step('Confirming the plot width and depth in the brief panel', instruction_id='e02e96b8-07c7-4a39-abd1-147d52e38df2'):
        await page.wait_for_timeout(200)
    
    async with testmu.step('Waiting for the generated plan refusal confirmation', instruction_id='416c1ab5-c60b-490d-9c52-94f545e4f2aa'):
        await page.wait_for_timeout(200)
    
    async with testmu.step('whether a red box saying the program does not fit the plot is present (in the left brief panel)', instruction_id='dec3d4b0-488e-417c-ba04-fd5151cc6738'):
        set_var('program_does_not_fit_refusal', await testmu.vision_query(page, "whether a red box saying the program does not fit the plot is present (in the left brief panel)", ""))
    
    async with testmu.step('whether a detail line giving the area asked for and the area the plot holds is present (in the red refusal box in the left brief panel)', instruction_id='f5f4d460-3667-4413-9101-24d7bcfd9885'):
        set_var('refusal_area_detail_line', await testmu.vision_query(page, "whether a detail line giving the area asked for and the area the plot holds is present (in the red refusal box in the left brief panel)", ""))
    
    async with testmu.step('whether a drawing of rooms that do not fit in the middle canvas is present (in the middle plan canvas)', instruction_id='654ca5cd-724d-46b7-ae29-2f279dd0af76'):
        set_var('nonfitting_rooms_drawing', await testmu.vision_query(page, "whether a drawing of rooms that do not fit in the middle canvas is present (in the middle plan canvas)", ""))
    
    async with testmu.step('The wording of the refusal in the red box is saved as {{refusal_wording}}.', instruction_id='60e968e6-b3d0-43dd-b038-2a63e7b3dde3'):
        set_var('refusal_wording', await testmu.vision_query(page, "The wording of the refusal in the red box is saved as {{refusal_wording}}.", ""))
    
    async with testmu.step('The area asked for and the area the plot holds from the refusal detail line are saved as {{refusal_area_numbers}}.', instruction_id='d8b4f0bb-1949-46aa-acaf-16c4fd8c01ce'):
        set_var('refusal_area_numbers', await testmu.vision_query(page, "The area asked for and the area the plot holds from the refusal detail line are saved as {{refusal_area_numbers}}.", ""))
    
    async with testmu.step('Assertion check', instruction_id='6fbb0eae-b326-4d2c-a187-382c34a57be1'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'A red box saying the program does not fit the plot is shown.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{program_does_not_fit_refusal}}', 'store_key': 'program_does_not_fit_refusal', 'variable_refs': {'{{program_does_not_fit_refusal}}': 'true'}}, {'description': 'A detail line gives the area asked for and the area the plot holds.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{refusal_area_detail_line}}', 'store_key': 'refusal_area_detail_line', 'variable_refs': {'{{refusal_area_detail_line}}': 'true'}}], 'sub_checks': [{'description': 'A red box saying the program does not fit the plot is shown.', 'store_key': 'program_does_not_fit_refusal', 'expected_value': 'true', 'extracted_value': '{{program_does_not_fit_refusal}}', 'operator': 'equals', 'transforms': []}, {'description': 'A detail line gives the area asked for and the area the plot holds.', 'store_key': 'refusal_area_detail_line', 'expected_value': 'true', 'extracted_value': '{{refusal_area_detail_line}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'A refusal is shown: a red box saying the program does not fit the plot, with a detail line that gives the area asked for and the area the plot holds.'})
    
    async with testmu.step('Assertion check', instruction_id='643a8948-0d83-4d0a-aed1-e3ca400a3083'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'false', 'extracted_value': '{{nonfitting_rooms_drawing}}', 'store_key': 'nonfitting_rooms_drawing', 'variable_refs': {'{{nonfitting_rooms_drawing}}': 'false'}}], 'sub_checks': [{'description': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.', 'store_key': 'nonfitting_rooms_drawing', 'expected_value': 'false', 'extracted_value': '{{nonfitting_rooms_drawing}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'The canvas in the middle no longer shows a drawing of rooms that do not fit.'})
    
    async with testmu.step('Waiting for the plan to generate', instruction_id='64fbe5ce-2743-4c9c-94b2-a3e55f3a76a1'):
        await page.wait_for_timeout(1000)
    
    async with testmu.step('Type "18" into "Plot width in metres"', instruction_id='e7b10b74-ab79-430c-a4a1-ad67d7bacf93'):
        element_2 = page.locator("internal:testid=[data-testid=\"plot-width\"s]")
        
        await testmu.fill(element_2, "18")
    
    async with testmu.step('Type "14" into "Plot depth in metres"', instruction_id='16c4ad59-905f-4fc9-b113-ae886e6639c5'):
        element_3 = page.locator("internal:testid=[data-testid=\"plot-depth\"s]")
        
        await testmu.fill(element_3, "14")
    
    async with testmu.step('Click "Generate the plan"', instruction_id='79f004d7-aff2-403f-b97f-56200ce80e81'):
        _loc_2 = page.locator("internal:testid=[data-testid=\"generate\"s]")
        
        await _loc_2.click()
    
    async with testmu.step('Confirming the generated plan after restoring plot width to 18 and depth to 14', instruction_id='b40d8318-f3bf-4277-9fae-bb15b9f7ed11'):
        await page.wait_for_timeout(200)
    
    async with testmu.step('whether a drawing is present (in the central plan area)', instruction_id='cfb67c26-8392-472d-9864-198c3402e566'):
        set_var('drawing_returns', await testmu.vision_query(page, "whether a drawing is present (in the central plan area)", ""))
    
    async with testmu.step('The result of each assertion is saved as {{assertion_results}}.', instruction_id='86a465a5-ff4c-4021-bfd1-8fefb7204383'):
        set_var('assertion_results', await testmu.vision_query(page, "The result of each assertion is saved as {{assertion_results}}.", ""))
    
    async with testmu.step('Assertion check', instruction_id='fdb2961c-3f2a-4bb9-abea-0dc1ccad199e'):
        await testmu.verify_assertion(page, 'Assertion check', {'operator': ['equals'], 'assertion_operands': [], 'left_operand': None, 'right_operand': None, 'operands': [], 'sub_results': [{'description': 'A drawing comes back.', 'passed': True, 'operator': 'equals', 'transforms': [], 'json_path': None, 'expected': 'true', 'extracted_value': '{{drawing_returns}}', 'store_key': 'drawing_returns', 'variable_refs': {'{{drawing_returns}}': 'true'}}], 'sub_checks': [{'description': 'A drawing comes back.', 'store_key': 'drawing_returns', 'expected_value': 'true', 'extracted_value': '{{drawing_returns}}', 'operator': 'equals', 'transforms': []}], 'composite_operator': 'and', 'claim': 'A drawing comes back.'})


if __name__ == "__main__":
    testmu.run(test)