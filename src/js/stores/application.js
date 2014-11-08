/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

define(function (require, exports, module) {
    "use strict";

    var Fluxxor = require("fluxxor"),
        events = require("../events");

    var ApplicationStore = Fluxxor.createStore({
        // Photoshop Version
        _hostVersion: null,

        /**
         * An ordered list of document IDs
         * @private
         * @type {Array.<number>}
         */
        _documentIDs: null,

        /**
         * The index of the currently active document, or null if there are none
         * @private
         * @type {?number}
         */
        _selectedDocumentIndex: null,

        /**
         * The ID of the currently active document, or null if there are none
         * @private
         * @type {?number}
         */
        _selectedDocumentID: null,

        initialize: function () {
            this._documentIDs = [];

            this.bindActions(
                events.application.HOST_VERSION, this.setHostVersion,
                events.documents.DOCUMENT_UPDATED, this._updateDocument,
                events.documents.CURRENT_DOCUMENT_UPDATED, this._updateCurrentDocument,
                events.documents.CLOSE_DOCUMENT, this._closeDocument,
                events.documents.RESET_DOCUMENTS, this._resetDocuments,
                events.documents.SELECT_DOCUMENT, this._documentSelected
            );
        },
        
        getState: function () {
            return {
                hostVersion: this._hostVersion,
                documentIDs: this._documentIDs,
                selectedDocumentIndex: this._selectedDocumentIndex,
                selectedDocumentID: this._documentIDs[this._selectedDocumentIndex]
            };
        },

        /**
         * Returns the id of currently active document, null if there is none
         *
         * @return {number}
         */
        getCurrentDocumentID: function () {
            return this._selectedDocumentID;
        },
        
        /**
         * Get the currently active document model, or null if there are none.
         * 
         * @return {?Document}
         */
        getCurrentDocument: function () {
            var documentStore = this.flux.store("document");
            return documentStore.getDocument(this._selectedDocumentID);
        },

        /**
         * Find either the next or previous document in the document index.
         * 
         * @private
         * @param {boolean} next Whether to find the next or previous document
         * @return {?Document}
         */
        _getNextPrevDocument: function (next) {
            if (this._selectedDocumentID === null) {
                return null;
            }

            var increment = next ? 1 : -1,
                nextDocumentIndex = this._selectedDocumentIndex + increment;

            if (nextDocumentIndex === this._documentIDs.length) {
                nextDocumentIndex = 0;
            } else if (nextDocumentIndex === -1) {
                nextDocumentIndex = this._documentIDs.length - 1;
            }

            var documentStore = this.flux.store("document"),
                nextDocmentID = this._documentIDs[nextDocumentIndex];

            return documentStore.getDocument(nextDocmentID);
        },

        /**
         * Find the next document in the document index.
         * 
         * @return {?Document}
         */
        getNextDocument: function () {
            return this._getNextPrevDocument(true);
        },

        /**
         * Find the previous document in the document index.
         * 
         * @return {?Document}
         */
        getPreviousDocument: function () {
            return this._getNextPrevDocument(false);
        },
        
        setHostVersion: function (payload) {
            var parts = [
                payload.hostVersion.versionMajor,
                payload.hostVersion.versionMinor,
                payload.hostVersion.versionFix
            ];

            this._hostVersion = parts.join(".");
            this.emit("change");
        },

        /**
         * Set the position of the given document ID in the document index.
         * 
         * @private
         * @param {number} documentID
         * @param {number} itemIndex
         */
        _updateDocumentPosition: function (documentID, itemIndex) {
            // find the document in the array of indices
            var currentIndex = -1;
            this._documentIDs.some(function (id, index) {
                if (id === documentID) {
                    currentIndex = index;
                    return true;
                }
            });

            // remove it from the array
            if (currentIndex > -1) {
                this._documentIDs.splice(currentIndex, 1);
            }

            // add it back at the correct index
            this._documentIDs.splice(itemIndex, 0, documentID);
        },

        /**
         * Set or reset the position of the given document in the document index.
         * 
         * @private
         * @param {{document: object, layers: Array.<object>}} payload
         */
        _updateDocument: function (payload) {
            this.waitFor(["document"], function () {
                var rawDocument = payload.document,
                    documentID = rawDocument.documentID,
                    itemIndex = rawDocument.itemIndex - 1; // doc indices start at 1

                this._updateDocumentPosition(documentID, itemIndex);

                this.emit("change");
            });
        },

        /**
         * Remove the given document ID from the document index, and set a new
         * selected document ID and index.
         * 
         * @private
         * @param {{document: object, layers: Array.<object>}} payload
         */
        _closeDocument: function (payload) {
            this.waitFor(["document"], function () {
                var documentID = payload.documentID,
                    selectedDocumentID = payload.selectedDocumentID;

                var documentIndex = this._documentIDs.indexOf(documentID);
                if (documentIndex === -1) {
                    throw new Error("Closed document ID not found in index: " + documentID);
                }

                this._documentIDs.splice(documentIndex, 1);

                var openDocumentCount = this._documentIDs.length;
                if ((openDocumentCount === 0) !== (selectedDocumentID === null)) {
                    throw new Error("Next selected document ID should be null iff there are no open documents");
                }

                if (openDocumentCount === 0) {
                    this._selectedDocumentID = null;
                    this._selectedDocumentIndex = null;
                    return;
                }

                var selectedDocumentIndex = this._documentIDs.indexOf(selectedDocumentID);
                if (selectedDocumentIndex === -1) {
                    throw new Error("Selected document ID not found in index: " + documentID);
                }

                this._selectedDocumentID = selectedDocumentID;
                this._selectedDocumentIndex = selectedDocumentIndex;

                this.emit("change");
            });
        },

        /**
         * Set or reset the position of the given document in the document index,
         * and mark it as the currently active document.
         * 
         * @private
         * @param {{document: object, layers: Array.<object>}} payload
         */
        _updateCurrentDocument: function (payload) {
            this.waitFor(["document"], function () {
                var rawDocument = payload.document,
                    documentID = rawDocument.documentID,
                    itemIndex = rawDocument.itemIndex - 1; // doc indices start at 1

                this._updateDocumentPosition(documentID, itemIndex);
                this._selectedDocumentID = documentID;
                this._selectedDocumentIndex = itemIndex;

                this.emit("change");
            });
        },

        /**
         * Reset the positions of all the documents in the document index, and reset
         * the currently active documents.
         * 
         * @private
         * @param {{selectedDocumentID: number, documents: Array.<{document: object, layers: Array.<object>}>}} payload
         */
        _resetDocuments: function (payload) {
            this.waitFor(["document"], function () {
                if (payload.documents.length === 0) {
                    this._documentIDs = [];
                    this._selectedDocumentID = null;
                    this._selectedDocumentIndex = null;
                } else {
                    this._documentIDs = payload.documents.map(function (docObj, index) {
                        var documentID = docObj.document.documentID;
                        if (payload.selectedDocumentID === documentID) {
                            this._selectedDocumentIndex = index;
                            this._selectedDocumentID = documentID;
                        }

                        return documentID;
                    }, this);
                }
                
                this.emit("change");
            });
        },

        /**
         * Set the currently active document.
         * 
         * @private
         * @param {{selectedDocumentID: number}} payload
         */
        _documentSelected: function (payload) {
            this._selectedDocumentID = payload.selectedDocumentID;
            this._selectedDocumentIndex = this._documentIDs.indexOf(payload.selectedDocumentID);

            this.emit("change");
        }
    });

    module.exports = ApplicationStore;
});
