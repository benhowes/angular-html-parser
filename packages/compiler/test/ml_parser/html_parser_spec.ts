/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import * as html from '../../src/ml_parser/ast';
import {HtmlParser, ParseTreeResult, TreeError} from '../../src/ml_parser/html_parser';
import {TokenType} from '../../src/ml_parser/lexer';
import {ParseError} from '../../src/parse_util';

import {humanizeDom, humanizeDomSourceSpans, humanizeLineColumn} from './ast_spec_utils';

{
  describe('HtmlParser', () => {
    let parser: HtmlParser;

    beforeEach(() => { parser = new HtmlParser(); });

    describe('parse', () => {
      describe('text nodes', () => {
        it('should parse root level text nodes', () => {
          expect(humanizeDom(parser.parse('a', 'TestComp'))).toEqual([[html.Text, 'a', 0]]);
        });

        it('should parse text nodes inside regular elements', () => {
          expect(humanizeDom(parser.parse('<div>a</div>', 'TestComp'))).toEqual([
            [html.Element, 'div', 0], [html.Text, 'a', 1]
          ]);
        });

        it('should parse text nodes inside <ng-template> elements', () => {
          expect(humanizeDom(parser.parse('<ng-template>a</ng-template>', 'TestComp'))).toEqual([
            [html.Element, 'ng-template', 0], [html.Text, 'a', 1]
          ]);
        });

        it('should parse CDATA', () => {
          expect(humanizeDom(parser.parse('<![CDATA[text]]>', 'TestComp'))).toEqual([
            [html.CDATA, 'text', 0]
          ]);
        });

        it('should parse DocType', () => {
          expect(humanizeDom(parser.parse('<!DocType  html >', 'TestComp'))).toEqual([
            [html.DocType, 'html', 0]
          ]);
        });
      });

      describe('elements', () => {
        it('should parse root level elements', () => {
          expect(humanizeDom(parser.parse('<div></div>', 'TestComp'))).toEqual([
            [html.Element, 'div', 0]
          ]);
        });

        it('should parse elements inside of regular elements', () => {
          expect(humanizeDom(parser.parse('<div><span></span></div>', 'TestComp'))).toEqual([
            [html.Element, 'div', 0], [html.Element, 'span', 1]
          ]);
        });

        it('should parse elements inside  <ng-template> elements', () => {
          expect(humanizeDom(parser.parse('<ng-template><span></span></ng-template>', 'TestComp')))
              .toEqual([[html.Element, 'ng-template', 0], [html.Element, 'span', 1]]);
        });

        it('should support void elements', () => {
          expect(humanizeDom(parser.parse('<link rel="author license" href="/about">', 'TestComp')))
              .toEqual([
                [html.Element, 'link', 0],
                [html.Attribute, 'rel', 'author license'],
                [html.Attribute, 'href', '/about'],
              ]);
        });

        it('should not error on void elements from HTML5 spec',
           () => {  // http://www.w3.org/TR/html-markup/syntax.html#syntax-elements without:
             // <base> - it can be present in head only
             // <meta> - it can be present in head only
             // <command> - obsolete
             // <keygen> - obsolete
             ['<map><area></map>', '<div><br></div>', '<colgroup><col></colgroup>',
              '<div><embed></div>', '<div><hr></div>', '<div><img></div>', '<div><input></div>',
              '<object><param>/<object>', '<audio><source></audio>', '<audio><track></audio>',
              '<p><wbr></p>',
             ].forEach((html) => { expect(parser.parse(html, 'TestComp').errors).toEqual([]); });
           });

        it('should close void elements on text nodes', () => {
          expect(humanizeDom(parser.parse('<p>before<br>after</p>', 'TestComp'))).toEqual([
            [html.Element, 'p', 0],
            [html.Text, 'before', 1],
            [html.Element, 'br', 1],
            [html.Text, 'after', 1],
          ]);
        });

        it('should support optional end tags', () => {
          expect(humanizeDom(parser.parse('<div><p>1<p>2</div>', 'TestComp'))).toEqual([
            [html.Element, 'div', 0],
            [html.Element, 'p', 1],
            [html.Text, '1', 2],
            [html.Element, 'p', 1],
            [html.Text, '2', 2],
          ]);
        });

        it('should support nested elements', () => {
          expect(humanizeDom(parser.parse('<ul><li><ul><li></li></ul></li></ul>', 'TestComp')))
              .toEqual([
                [html.Element, 'ul', 0],
                [html.Element, 'li', 1],
                [html.Element, 'ul', 2],
                [html.Element, 'li', 3],
              ]);
        });

        /**
         * Certain elements (like <tr> or <col>) require parent elements of a certain type (ex. <tr>
         * can only be inside <tbody> / <thead>). The Angular HTML parser doesn't validate those
         * HTML compliancy rules as "problematic" elements can be projected - in such case HTML (as
         * written in an Angular template) might be "invalid" (spec-wise) but the resulting DOM will
         * still be correct.
         */
        it('should not wraps elements in a required parent', () => {
          expect(humanizeDom(parser.parse('<div><tr></tr></div>', 'TestComp'))).toEqual([
            [html.Element, 'div', 0],
            [html.Element, 'tr', 1],
          ]);
        });

        it('should support explicit namespace', () => {
          expect(humanizeDom(parser.parse('<myns:div></myns:div>', 'TestComp'))).toEqual([
            [html.Element, ':myns:div', 0]
          ]);
        });

        it('should support implicit namespace', () => {
          expect(humanizeDom(parser.parse('<svg></svg>', 'TestComp'))).toEqual([
            [html.Element, ':svg:svg', 0]
          ]);
        });

        it('should propagate the namespace', () => {
          expect(humanizeDom(parser.parse('<myns:div><p></p></myns:div>', 'TestComp'))).toEqual([
            [html.Element, ':myns:div', 0],
            [html.Element, ':myns:p', 1],
          ]);
        });

        it('should match local closing tags case insensitive', () => {
          expect(humanizeDom(parser.parse('<DiV><P></p></dIv>', 'TestComp'))).toEqual([
            [html.Element, 'DiV', 0],
            [html.Element, 'P', 1],
          ]);
        });

        it('should match foreign closing tags case sensitive', () => {
          const errors = parser.parse('<x:DiV><P></p></x:dIv>', 'TestComp').errors;
          expect(errors.length).toEqual(2);
          expect(humanizeErrors(errors)).toEqual([
            [
              ':x:p',
              'Unexpected closing tag ":x:p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
              '0:10'
            ],
            [
              ':x:dIv',
              'Unexpected closing tag ":x:dIv". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
              '0:14'
            ],
          ]);
        });

        it('should support self closing void elements', () => {
          expect(humanizeDom(parser.parse('<input />', 'TestComp'))).toEqual([
            [html.Element, 'input', 0]
          ]);
        });

        it('should support self closing foreign elements', () => {
          expect(humanizeDom(parser.parse('<math />', 'TestComp'))).toEqual([
            [html.Element, ':math:math', 0]
          ]);
        });

        it('should support self closing elements with canSelfClose', () => {
          expect(humanizeDom(parser.parse('<div />', 'TestComp', {canSelfClose: true}))).toEqual([
            [html.Element, 'div', 0]
          ]);
        });

        it('should support self closing elements (contentType=RAW_TEXT) with canSelfClose', () => {
          expect(humanizeDom(parser.parse('<script />', 'TestComp', {canSelfClose: true}))).toEqual([
            [html.Element, 'script', 0]
          ]);
        });

        it('should ignore LF immediately after textarea, pre and listing', () => {
          expect(humanizeDom(parser.parse(
                     '<p>\n</p><textarea>\n</textarea><pre>\n\n</pre><listing>\n\n</listing>',
                     'TestComp')))
              .toEqual([
                [html.Element, 'p', 0],
                [html.Text, '\n', 1],
                [html.Element, 'textarea', 0],
                [html.Element, 'pre', 0],
                [html.Text, '\n', 1],
                [html.Element, 'listing', 0],
                [html.Text, '\n', 1],
              ]);
        });

        it('should allow htm component tag close if enabled', () => {
          expect(humanizeDom(parser.parse(
                     'foo<Footer>footer content</ / >bar',
                     'TestComp', {allowHtmComponentClosingTags: true})))
              .toEqual([
                [html.Text, 'foo', 0],
                [html.Element, 'Footer', 0],
                [html.Text, 'footer content', 1],
                [html.Text, 'bar', 0],
              ]);
        });
      });

      describe('attributes', () => {
        it('should parse attributes on regular elements case sensitive', () => {
          expect(humanizeDom(parser.parse('<div kEy="v" key2=v2></div>', 'TestComp'))).toEqual([
            [html.Element, 'div', 0],
            [html.Attribute, 'kEy', 'v'],
            [html.Attribute, 'key2', 'v2'],
          ]);
        });

        it('should parse attributes without values', () => {
          expect(humanizeDom(parser.parse('<div k></div>', 'TestComp'))).toEqual([
            [html.Element, 'div', 0],
            [html.Attribute, 'k', ''],
          ]);
        });

        it('should parse attributes on svg elements case sensitive', () => {
          expect(humanizeDom(parser.parse('<svg viewBox="0"></svg>', 'TestComp'))).toEqual([
            [html.Element, ':svg:svg', 0],
            [html.Attribute, 'viewBox', '0'],
          ]);
        });

        it('should parse attributes on <ng-template> elements', () => {
          expect(humanizeDom(parser.parse('<ng-template k="v"></ng-template>', 'TestComp')))
              .toEqual([
                [html.Element, 'ng-template', 0],
                [html.Attribute, 'k', 'v'],
              ]);
        });

        it('should support namespace', () => {
          expect(humanizeDom(parser.parse('<svg:use xlink:href="Port" />', 'TestComp'))).toEqual([
            [html.Element, ':svg:use', 0],
            [html.Attribute, ':xlink:href', 'Port'],
          ]);
        });
      });

      describe('comments', () => {
        it('should preserve comments', () => {
          expect(humanizeDom(parser.parse('<!-- comment --><div></div>', 'TestComp'))).toEqual([
            [html.Comment, 'comment', 0],
            [html.Element, 'div', 0],
          ]);
        });
      });

      describe('bogus comments', () => {
        it('should preserve bogus comments', () => {
          expect(humanizeDom(parser.parse('<!- comment --><div></div>', 'TestComp'))).toEqual([
            [html.Comment, '- comment --', 0],
            [html.Element, 'div', 0],
          ]);
        });

        it('should preserve bogus comments', () => {
          expect(humanizeDom(parser.parse('<?- comment --><div></div>', 'TestComp'))).toEqual([
            [html.Comment, '?- comment --', 0],
            [html.Element, 'div', 0],
          ]);
        });
      });

      describe('expansion forms', () => {
        it('should parse out expansion forms', () => {
          const parsed = parser.parse(
              `<div>before{messages.length, plural, =0 {You have <b>no</b> messages} =1 {One {{message}}}}after</div>`,
              'TestComp', {tokenizeExpansionForms: true});

          expect(humanizeDom(parsed)).toEqual([
            [html.Element, 'div', 0],
            [html.Text, 'before', 1],
            [html.Expansion, 'messages.length', 'plural', 1],
            [html.ExpansionCase, '=0', 2],
            [html.ExpansionCase, '=1', 2],
            [html.Text, 'after', 1],
          ]);
          const cases = (<any>parsed.rootNodes[0]).children[1].cases;

          expect(humanizeDom(new ParseTreeResult(cases[0].expression, []))).toEqual([
            [html.Text, 'You have ', 0],
            [html.Element, 'b', 0],
            [html.Text, 'no', 1],
            [html.Text, ' messages', 0],
          ]);

          expect(humanizeDom(new ParseTreeResult(cases[1].expression, [
          ]))).toEqual([[html.Text, 'One {{message}}', 0]]);
        });

        it('should parse out expansion forms', () => {
          const parsed = parser.parse(
              `<div><span>{a, plural, =0 {b}}</span></div>`, 'TestComp',
              {tokenizeExpansionForms: true});

          expect(humanizeDom(parsed)).toEqual([
            [html.Element, 'div', 0],
            [html.Element, 'span', 1],
            [html.Expansion, 'a', 'plural', 2],
            [html.ExpansionCase, '=0', 3],
          ]);
        });

        it('should parse out nested expansion forms', () => {
          const parsed = parser.parse(
              `{messages.length, plural, =0 { {p.gender, select, male {m}} }}`, 'TestComp',
              {tokenizeExpansionForms: true});
          expect(humanizeDom(parsed)).toEqual([
            [html.Expansion, 'messages.length', 'plural', 0],
            [html.ExpansionCase, '=0', 1],
          ]);

          const firstCase = (<any>parsed.rootNodes[0]).cases[0];

          expect(humanizeDom(new ParseTreeResult(firstCase.expression, []))).toEqual([
            [html.Expansion, 'p.gender', 'select', 0],
            [html.ExpansionCase, 'male', 1],
            [html.Text, ' ', 0],
          ]);
        });

        it('should error when expansion form is not closed', () => {
          const p = parser.parse(
              `{messages.length, plural, =0 {one}`, 'TestComp', {tokenizeExpansionForms: true});
          expect(humanizeErrors(p.errors)).toEqual([
            [null, 'Invalid ICU message. Missing \'}\'.', '0:34']
          ]);
        });

        it('should support ICU expressions with cases that contain numbers', () => {
          const p = parser.parse(
              `{sex, select, male {m} female {f} 0 {other}}`, 'TestComp',
              {tokenizeExpansionForms: true});
          expect(p.errors.length).toEqual(0);
        });

        it('should error when expansion case is not closed', () => {
          const p = parser.parse(
              `{messages.length, plural, =0 {one`, 'TestComp', {tokenizeExpansionForms: true});
          expect(humanizeErrors(p.errors)).toEqual([
            [null, 'Invalid ICU message. Missing \'}\'.', '0:29']
          ]);
        });

        it('should error when invalid html in the case', () => {
          const p = parser.parse(
              `{messages.length, plural, =0 {<b/>}`, 'TestComp', {tokenizeExpansionForms: true});
          expect(humanizeErrors(p.errors)).toEqual([
            ['b', 'Only void and foreign elements can be self closed "b"', '0:30']
          ]);
        });
      });

      describe('source spans', () => {
        it('should store the location', () => {
          expect(humanizeDomSourceSpans(parser.parse(
                     '<div [prop]="v1" (e)="do()" attr="v2" noValue>\na\n</div>', 'TestComp')))
              .toEqual([
                [html.Element, 'div', 0, '<div [prop]="v1" (e)="do()" attr="v2" noValue>'],
                [html.Attribute, '[prop]', 'v1', '[prop]="v1"'],
                [html.Attribute, '(e)', 'do()', '(e)="do()"'],
                [html.Attribute, 'attr', 'v2', 'attr="v2"'],
                [html.Attribute, 'noValue', '', 'noValue'],
                [html.Text, '\na\n', 1, '\na\n'],
              ]);
        });

        it('should set the start and end source spans', () => {
          const node = <html.Element>parser.parse('<div>a</div>', 'TestComp').rootNodes[0];

          expect(node.startSourceSpan !.start.offset).toEqual(0);
          expect(node.startSourceSpan !.end.offset).toEqual(5);

          expect(node.endSourceSpan !.start.offset).toEqual(6);
          expect(node.endSourceSpan !.end.offset).toEqual(12);
        });

        it('should support expansion form', () => {
          expect(humanizeDomSourceSpans(parser.parse(
                     '<div>{count, plural, =0 {msg}}</div>', 'TestComp',
                     {tokenizeExpansionForms: true})))
              .toEqual([
                [html.Element, 'div', 0, '<div>'],
                [html.Expansion, 'count', 'plural', 1, '{count, plural, =0 {msg}}'],
                [html.ExpansionCase, '=0', 2, '=0 {msg}'],
              ]);
        });

        it('should not report a value span for an attribute without a value', () => {
          const ast = parser.parse('<div bar></div>', 'TestComp');
          expect((ast.rootNodes[0] as html.Element).attrs[0].valueSpan).toBeNull();
        });

        it('should report a value span for an attribute with a value', () => {
          const ast = parser.parse('<div bar="12"></div>', 'TestComp');
          const attr = (ast.rootNodes[0] as html.Element).attrs[0];
          expect(attr.valueSpan !.start.offset).toEqual(9);
          expect(attr.valueSpan !.end.offset).toEqual(13);
        });

        it('should report a value span for an unquoted attribute value', () => {
          const ast = parser.parse('<div bar=12></div>', 'TestComp');
          const attr = (ast.rootNodes[0] as html.Element).attrs[0];
          expect(attr.valueSpan !.start.offset).toEqual(9);
          expect(attr.valueSpan !.end.offset).toEqual(11);
        });

        it('should report a name span for an attribute', () => {
          const ast = parser.parse('<div bar="12"></div>', 'TestComp');
          const attr = (ast.rootNodes[0] as html.Element).attrs[0];
          expect(attr.nameSpan !.start.offset).toEqual(5);
          expect(attr.nameSpan !.end.offset).toEqual(8);
        });

        it('should report a name span for an element', () => {
          const ast = parser.parse('<div bar="12"></div>', 'TestComp');
          const el = (ast.rootNodes[0] as html.Element);
          expect(el.nameSpan !.start.offset).toEqual(1);
          expect(el.nameSpan !.end.offset).toEqual(4);
        });

        it('should support comment', () => {
          const ast = parser.parse('<!--foo-->', 'TestComp');
          const comment = (ast.rootNodes[0] as html.Comment);
          expect(comment.sourceSpan !.start.offset).toEqual(0);
          expect(comment.sourceSpan !.end.offset).toEqual(10);
        });
      });

      describe('visitor', () => {
        it('should visit text nodes', () => {
          const result = humanizeDom(parser.parse('text', 'TestComp'));
          expect(result).toEqual([[html.Text, 'text', 0]]);
        });

        it('should visit element nodes', () => {
          const result = humanizeDom(parser.parse('<div></div>', 'TestComp'));
          expect(result).toEqual([[html.Element, 'div', 0]]);
        });

        it('should visit attribute nodes', () => {
          const result = humanizeDom(parser.parse('<div id="foo"></div>', 'TestComp'));
          expect(result).toContain([html.Attribute, 'id', 'foo']);
        });

        it('should visit all nodes', () => {
          const result =
              parser.parse('<div id="foo"><span id="bar">a</span><span>b</span></div>', 'TestComp');
          const accumulator: html.Node[] = [];
          const visitor = new class {
            visit(node: html.Node, context: any) { accumulator.push(node); }
            visitElement(element: html.Element, context: any): any {
              html.visitAll(this, element.attrs);
              html.visitAll(this, element.children);
            }
            visitAttribute(attribute: html.Attribute, context: any): any {}
            visitText(text: html.Text, context: any): any {}
            visitComment(comment: html.Comment, context: any): any {}
            visitCdata(cdata: html.CDATA, context: any): any {}
            visitDocType(docType: html.DocType, context: any): any {}
            visitExpansion(expansion: html.Expansion, context: any): any {
              html.visitAll(this, expansion.cases);
            }
            visitExpansionCase(expansionCase: html.ExpansionCase, context: any): any {}
          };

          html.visitAll(visitor, result.rootNodes);
          expect(accumulator.map(n => n.constructor)).toEqual([
            html.Element, html.Attribute, html.Element, html.Attribute, html.Text, html.Element,
            html.Text
          ]);
        });

        it('should skip typed visit if visit() returns a truthy value', () => {
          const visitor = new class {
            visit(node: html.Node, context: any) { return true; }
            visitElement(element: html.Element, context: any): any { throw Error('Unexpected'); }
            visitAttribute(attribute: html.Attribute, context: any): any {
              throw Error('Unexpected');
            }
            visitText(text: html.Text, context: any): any { throw Error('Unexpected'); }
            visitComment(comment: html.Comment, context: any): any { throw Error('Unexpected'); }
            visitCdata(cdata: html.CDATA, context: any): any { throw Error('Unexpected'); }
            visitDocType(docType: html.DocType, context: any): any { throw Error('Unexpected'); }
            visitExpansion(expansion: html.Expansion, context: any): any {
              throw Error('Unexpected');
            }
            visitExpansionCase(expansionCase: html.ExpansionCase, context: any): any {
              throw Error('Unexpected');
            }
          };
          const result = parser.parse('<div id="foo"></div><div id="bar"></div>', 'TestComp');
          const traversal = html.visitAll(visitor, result.rootNodes);
          expect(traversal).toEqual([true, true]);
        });
      });

      describe('errors', () => {
        it('should report unexpected closing tags', () => {
          const errors = parser.parse('<div></p></div>', 'TestComp').errors;
          expect(errors.length).toEqual(1);
          expect(humanizeErrors(errors)).toEqual([[
            'p',
            'Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
            '0:5'
          ]]);
        });

        it('should report subsequent open tags without proper close tag', () => {
          const errors = parser.parse('<div</div>', 'TestComp').errors;
          expect(errors.length).toEqual(1);
          expect(humanizeErrors(errors)).toEqual([[
            'div',
            'Unexpected closing tag "div". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
            '0:4'
          ]]);
        });

        it('should report closing tag for void elements', () => {
          const errors = parser.parse('<input></input>', 'TestComp').errors;
          expect(errors.length).toEqual(1);
          expect(humanizeErrors(errors)).toEqual([
            ['input', 'Void elements do not have end tags "input"', '0:7']
          ]);
        });

        it('should not report closing tag for non-lowercase void elements with isTagNameCaseSensitive', () => {
          const errors = parser.parse('<Input></Input>', 'TestComp', undefined, true).errors;
          expect(errors.length).toEqual(0);
        });

        it('should report self closing html element', () => {
          const errors = parser.parse('<p />', 'TestComp').errors;
          expect(errors.length).toEqual(1);
          expect(humanizeErrors(errors)).toEqual([
            ['p', 'Only void and foreign elements can be self closed "p"', '0:0']
          ]);
        });

        it('should report self closing custom element', () => {
          const errors = parser.parse('<my-cmp />', 'TestComp').errors;
          expect(errors.length).toEqual(1);
          expect(humanizeErrors(errors)).toEqual([
            ['my-cmp', 'Only void and foreign elements can be self closed "my-cmp"', '0:0']
          ]);
        });

        it('should also report lexer errors', () => {
          const errors = parser.parse('<!-err--><div></p></div>', 'TestComp').errors;
          expect(errors.length).toEqual(1);
          expect(humanizeErrors(errors)).toEqual([
            [
              'p',
              'Unexpected closing tag "p". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
              '0:14'
            ]
          ]);
        });
      });
    });
  });
}

export function humanizeErrors(errors: ParseError[]): any[] {
  return errors.map(e => {
    if (e instanceof TreeError) {
      // Parser errors
      return [<any>e.elementName, e.msg, humanizeLineColumn(e.span.start)];
    }
    // Tokenizer errors
    return [(<any>e).tokenType, e.msg, humanizeLineColumn(e.span.start)];
  });
}
