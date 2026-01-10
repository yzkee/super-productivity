import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MarkdownModule } from 'ngx-markdown';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { InlineMarkdownComponent } from './inline-markdown.component';
import { GlobalConfigService } from '../../features/config/global-config.service';

describe('InlineMarkdownComponent', () => {
  let component: InlineMarkdownComponent;
  let fixture: ComponentFixture<InlineMarkdownComponent>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(async () => {
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      misc: jasmine.createSpy().and.returnValue({ isTurnOffMarkdown: false }),
    });
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [InlineMarkdownComponent, MarkdownModule.forRoot(), NoopAnimationsModule],
      providers: [
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: MatDialog, useValue: mockMatDialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InlineMarkdownComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnDestroy', () => {
    it('should emit changed event with current value when in edit mode and value has changed', () => {
      // Arrange
      const originalValue = 'original text';
      const changedValue = 'changed text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with changed value
      const mockTextareaEl = {
        nativeElement: { value: changedValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith(changedValue);
    });

    it('should not emit changed event when in edit mode but value has not changed', () => {
      // Arrange
      const originalValue = 'original text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with unchanged value
      const mockTextareaEl = {
        nativeElement: { value: originalValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should not emit changed event when not in edit mode', () => {
      // Arrange
      const originalValue = 'original text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Ensure we're not in edit mode
      component['isShowEdit'].set(false);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should not emit changed event when textarea element is not available', () => {
      // Arrange
      spyOn(component.changed, 'emit');

      component.model = 'some text';
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element as undefined
      spyOn(component, 'textareaEl').and.returnValue(undefined);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should clear timeout and still emit changed event if needed', () => {
      // Arrange
      const originalValue = 'original text';
      const changedValue = 'changed text';
      spyOn(component.changed, 'emit');
      spyOn(window, 'clearTimeout');

      // Set up a timeout to be cleared
      component['_hideOverFlowTimeout'] = window.setTimeout(() => {}, 1000);

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with changed value
      const mockTextareaEl = {
        nativeElement: { value: changedValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(window.clearTimeout).toHaveBeenCalled();
      expect(component.changed.emit).toHaveBeenCalledWith(changedValue);
    });
  });

  describe('_handleCheckboxClick', () => {
    let mockPreviewEl: { element: { nativeElement: HTMLElement } };

    beforeEach(() => {
      mockPreviewEl = {
        element: {
          nativeElement: document.createElement('div'),
        },
      };
      spyOn(component, 'previewEl').and.returnValue(mockPreviewEl as any);
      spyOn(component.changed, 'emit');
    });

    it('should toggle first checkbox in simple checklist', () => {
      // Arrange
      component.model = '- [ ] Task 1\n- [ ] Task 2';
      fixture.detectChanges();

      // Create mock checkbox wrappers
      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      wrapper1.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 1';

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      wrapper2.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 2';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act
      component['_handleCheckboxClick'](wrapper1);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith('- [x] Task 1\n- [ ] Task 2');
    });

    it('should toggle checkbox after blank line', () => {
      // Arrange - this is the bug scenario from issue #5950
      component.model = '- [ ] Task 1\n\n- [ ] Task 2';
      fixture.detectChanges();

      // Create mock checkbox wrappers (blank line doesn't create a wrapper)
      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      wrapper1.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 1';

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      wrapper2.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 2';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act - click the second checkbox (Task 2)
      component['_handleCheckboxClick'](wrapper2);

      // Assert - Task 2 should be toggled, not Task 1
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] Task 1\n\n- [x] Task 2');
    });

    it('should toggle checkbox with multiple blank lines', () => {
      // Arrange
      component.model = '- [ ] Task 1\n\n\n- [ ] Task 2\n\n- [ ] Task 3';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      wrapper1.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 1';

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      wrapper2.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 2';

      const wrapper3 = document.createElement('li');
      wrapper3.className = 'checkbox-wrapper';
      wrapper3.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 3';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);
      mockPreviewEl.element.nativeElement.appendChild(wrapper3);

      // Act - click the third checkbox (Task 3)
      component['_handleCheckboxClick'](wrapper3);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith(
        '- [ ] Task 1\n\n\n- [ ] Task 2\n\n- [x] Task 3',
      );
    });

    it('should uncheck a checked checkbox', () => {
      // Arrange
      component.model = '- [x] Task 1\n- [ ] Task 2';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      wrapper1.innerHTML = '<span class="checkbox material-icons">check_box</span>Task 1';

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      wrapper2.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 2';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act
      component['_handleCheckboxClick'](wrapper1);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] Task 1\n- [ ] Task 2');
    });
  });

  describe('clickPreview with loose lists (blank lines)', () => {
    let mockPreviewEl: { element: { nativeElement: HTMLElement } };

    beforeEach(() => {
      mockPreviewEl = {
        element: {
          nativeElement: document.createElement('div'),
        },
      };
      spyOn(component, 'previewEl').and.returnValue(mockPreviewEl as any);
      spyOn(component.changed, 'emit');
    });

    it('should handle checkbox click when checkbox is wrapped in <p> tag (loose list)', () => {
      // Arrange - simulates loose list HTML: <li class="checkbox-wrapper"><p><span class="checkbox">...</span>Task</p></li>
      component.model = '- [ ] Task 1\n\n- [ ] Task 2';
      fixture.detectChanges();

      // Build DOM structure for loose list (with <p> wrapper)
      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper undone';
      const p1 = document.createElement('p');
      const checkbox1 = document.createElement('span');
      checkbox1.className = 'checkbox material-icons';
      checkbox1.textContent = 'check_box_outline_blank';
      p1.appendChild(checkbox1);
      p1.appendChild(document.createTextNode('Task 1'));
      wrapper1.appendChild(p1);

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper undone';
      const p2 = document.createElement('p');
      const checkbox2 = document.createElement('span');
      checkbox2.className = 'checkbox material-icons';
      checkbox2.textContent = 'check_box_outline_blank';
      p2.appendChild(checkbox2);
      p2.appendChild(document.createTextNode('Task 2'));
      wrapper2.appendChild(p2);

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act - simulate clicking the second checkbox
      const mockEvent = {
        target: checkbox2,
      } as unknown as MouseEvent;
      component.clickPreview(mockEvent);

      // Assert - Task 2 should be toggled
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] Task 1\n\n- [x] Task 2');
    });
  });
});
