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

    var React = require("react"),
        Fluxxor = require("fluxxor"),
        FluxMixin = Fluxxor.FluxMixin(React),
        StoreWatchMixin = Fluxxor.StoreWatchMixin,
        Immutable = require("immutable"),
        _ = require("lodash");

    var os = require("adapter").os;

    var collection = require("js/util/collection"),
        nls = require("js/util/nls"),
        Datalist = require("js/jsx/shared/Datalist"),
        SVGIcon = require("js/jsx/shared/SVGIcon"),
        headlights = require("js/util/headlights"),
        Button = require("js/jsx/shared/Button");

    /**
     * The ID of the option display when there are no other valid results
     *
     * @const
     * @type {string}
     */
    var PLACEHOLDER_ID = "NO_OPTIONS-placeholder";

    var SearchBar = React.createClass({
        mixins: [FluxMixin, StoreWatchMixin("search", "application")],

        propTypes: {
            dismissDialog: React.PropTypes.func,
            // Function to perform an action when an option is confirmed
            executeOption: React.PropTypes.func.isRequired,
            // Unique identifying string for the search module
            searchID: React.PropTypes.string.isRequired
        },

        getStateFromFlux: function () {
            var flux = this.getFlux(),
                appStore = flux.store("application"),
                searchStore = flux.store("search"),
                searchState = searchStore.getState(this.props.searchID),
                options = searchState.searchItems,
                filterItems = options.filter(function (opt) {
                    return opt.type === "filter";
                }),
                filterIDs = collection.pluck(filterItems, "id").toJS();

            filterIDs.push(PLACEHOLDER_ID);

            return {
                // All possible search options as a flat list
                options: options,
                // All possible search options, grouped in Immutable lists by search type
                groupedOptions: searchState.groupedSearchItems,
                // Broad categories of what SearchBar has as options
                searchTypes: searchState.headers,
                // List of more specific categories that correlate with searchTypes to be used as filters
                // Indicate that there are no categories for a search type with null
                searchCategories: searchState.filters,
                // List of IDs corresponding with the filter options and the placeholder option
                // Gets passed to Datalist as list of option IDs that when selected, should not close the dialog
                filterIDs: filterIDs,
                // Filter names that are user-inputted strings, stored under IDs
                safeFilterNameMap: searchState.safeFilterNameMap,
                // Whether or not there are uninitialized documents waiting to be initialized
                ready: appStore.getUninitializedDocuments().size === 0
            };
        },

        getDefaultProps: function () {
            return {
                dismissDialog: _.identity,
                searchID: "",
                maxOptions: 30
            };
        },

        getInitialState: function () {
            return {
                // The currently applied filter
                filters: [],
                // SVG class for icon for the currently applied filter
                icon: null,
                hasInputValue: null
            };
        },

        /**
         * Explicitly focus the text input of the search datalist when the window is activated.
         *
         * @private
         * @param {{becameActive: boolean}} event
         */
        _handleActivationChanged: function (event) {
            if (event.becameActive) {
                // SuperHack: Work around a Chromium bug in which activating the window
                // blurs (at some point) the focused input. See #3519.
                window.setTimeout(function () {
                    if (this.state.ready) {
                        this.refs.datalist.focus();
                    }
                }.bind(this), 100);
            }
        },

        /**
         * Initialize search providers for the given searchID.
         *
         * @private
         */
        _initSearchProviders: function () {
            var searchStore = this.getFlux().store("search");
            searchStore._updateSearchItems(this.props.searchID);
        },

        componentWillMount: function () {
            this.getFlux().actions.documents.initializeDocumentsThrottled();
        },

        componentDidMount: function () {
            if (this.state.ready) {
                // In case all documents are already initialized
                this._initSearchProviders();
            }

            os.addListener("activationChanged", this._handleActivationChanged);
        },

        componentWillUnmount: function () {
            os.removeListener("activationChanged", this._handleActivationChanged);
        },

        componentDidUpdate: function (prevProps, prevState) {
            if (!prevState.ready && this.state.ready) {
                // In case some documents were not initialized, but now are
                this._initSearchProviders();
            } else if (prevState.ready && !this.state.ready) {
                // In case there are newly uninitiazlied documents
                this.getFlux().actions.documents.initializeDocumentsThrottled();
            }

            if (this.state.ready) {
                // Ensures that the text input has focus once the datalist goes from
                // a read-only initializing state to being ready.
                this.refs.datalist.focus();
            }

            if (prevState.filters !== this.state.filters && this.refs.datalist) {
                this._updateDatalistInput(this.state.filters);
                // Force update because Datalist's state might not change at all
                this.refs.datalist.forceUpdate();
            }
        },

        /**
         * Dismiss the parent dialog
         *
         * @param {SyntheticEvent} event
         */
        _dismissDialog: function (event) {
            if (_.isFunction(this.props.dismissDialog)) {
                this.props.dismissDialog(event);
            }
        },

        /**
         * Updates filter state to be values contained in the provided id of a filter item
         *
         * @param {string} id Filter ID. If null, then reset filter to no value
         */
        _updateFilter: function (id) {
            var idArray = id ? id.split("-") : [],
                filterValues = _.drop(idArray);

            var updatedFilter = id ? _.uniq(this.state.filters.concat(filterValues)) : [],
                filterIcon = id && this.getFlux().store("search").getSVGClass(updatedFilter),
                nextHasInputValue = id !== null;
            
            this.setState({
                filters: updatedFilter,
                icon: filterIcon,
                hasInputValue: nextHasInputValue
            });
        },

        /**
         * Removes words from Datalist input that are contained in the ID
         *
         * @param {Array.<string>} idArray of selected items
         */
        _updateDatalistInput: function (idArray) {
            if (idArray) {
                var idString = _.map(idArray, function (idWord) {
                        var toRemove;
                        
                        try {
                            toRemove = nls.localize("strings.SEARCH.CATEGORIES." + idWord);
                        } catch (e) {
                            // If translation is not found, try map the id to a filter name (e.g. CC Library name)
                            toRemove = this.state.safeFilterNameMap[idWord];
                        }

                        return toRemove ? toRemove.replace(" ", "") : idWord;
                    }, this).join("").toLowerCase(),
                    partialMatch,
                    currFilter = this.refs.datalist.getInputValue().split(" "),
                    nextFilterMap = _.map(currFilter, function (word) {
                        // This allows the datalist to populate with all or partial string matches 
                        // to the user inputted string.
                        if (idString.includes(word.toLowerCase())) {
                            partialMatch = true;
                            return "";
                        } else {
                            return word;
                        }
                    }),
                    nextFilter;
                    
                if (partialMatch) {
                    nextFilter = "";
                } else {
                    nextFilter = nextFilterMap.join(" ").trim();
                }

                this.refs.datalist.updateFilter(nextFilter);
            } else {
                this.refs.datalist.updateFilter(null);
            }
        },

        /**
         * Find options to render in the Datalist drop down, limited by the text input value
         * and the applied filter (if there is one)
         *
         * @param {string} searchTerm Term to filter by
         * @param {string} autofillID ID of option that is currently being suggested
         * @param {bool} truncate Whether or not to restrict number of options
         * @return {Immutable.List.<object>}
         */
        _filterSearchOptions: function (searchTerm, autofillID, truncate) {
            var optionGroups = this.state.groupedOptions;

            if (!optionGroups) {
                return Immutable.List();
            }

            // Look at each group of options (grouped by header category), and
            // put all valid options in a list of pairs [option, priority],
            // where option is the option itself and priority is an integer representing
            // how close that option is to the entered search terms (lower integers->better match)
            var filteredOptionGroups = optionGroups.map(function (options) {
                var priorities = [];
                
                // Build list of option, priority pairs
                options.forEach(function (option) {
                    if (option.hidden) {
                        return;
                    }

                    // Always add headers to list of searchable options
                    // The check to not render if there are no options below it is in Select.jsx
                    if (option.type === "header") {
                        priorities.push([option, -1]);
                        return;
                    }

                    var title = option.title.toLowerCase(),
                        category = option.category || [];
 
                    if (option.type === "filter") {
                        // If it is the filter option for something that we already have filtered, don't
                        // show that filter option
                        if (_.isEqual(this.state.filters, category)) {
                            return;
                        }

                        // No document, so don't render document-only filters
                        if (!this.getFlux().stores.application.getCurrentDocument() && option.haveDocument) {
                            return;
                        }
                    }

                    // All terms in this.state.filters must be in the option's category
                    if (this.state.filters && this.state.filters.length > 0) {
                        var dontUseTerm = _.some(this.state.filters, function (filterValue) {
                            return (!_.contains(category, filterValue));
                        });

                        if (dontUseTerm) {
                            return;
                        }
                    }

                    var priority = 1; // Add to priority to indicate less important

                    // If haven't typed anything, want to use everything that fits into the category
                    if (searchTerm === "") {
                        priorities.push([option, priority]);
                        return;
                    }

                    priority++;

                    // If option has a path, search for it with and without '/', '>' characters
                    var pathInfo = option.pathInfo ? option.pathInfo.toLowerCase() + " " : "",
                        searchablePath = pathInfo.concat(pathInfo.replace(/[\/,>]/g, " ")),
                        searchTerms = searchTerm.split(" "),
                        numTermsInTitle = 0,
                        useTerm = false,
                        titleWords = title.split(" ");

                    // At least one term in the search box must be in the option's title
                    // or path. Could add check for if term is somewhere in category list too
                    _.forEach(searchTerms, function (term) {
                        var titleContains = title.indexOf(term) > -1,
                            pathContains = searchablePath.indexOf(term) > -1,
                            titleMatches = titleContains ? titleWords.indexOf(term) > -1 : false;
                        
                        if (term !== "" && (titleContains || pathContains)) {
                            useTerm = true;
                            numTermsInTitle++;

                            // If the title contains the term, then it is a better
                            // priority than if just the path contains the term
                            if (titleContains) {
                                numTermsInTitle++;
                            }

                            // If the title matches the term, then it is an even better priority
                            if (titleMatches) {
                                numTermsInTitle++;
                            }
                        }
                    });

                    // Multiply by 3 so that we are always adding a positive number
                    // since numTermsInTitle is at most 3 times the length of the input
                    priority += (3 * searchTerms.length - numTermsInTitle);
                    
                    // If option is the autofill option, should jump to the top
                    if (option.id === autofillID) {
                        priority = 0;
                    }

                    if (useTerm) {
                        priorities.push([option, priority]);
                    }
                }.bind(this));

                return Immutable.List(priorities);
            }.bind(this));

            // Sort options by priority and put all options together in one list
            var optionList = filteredOptionGroups.reduce(function (filteredOptions, group) {
                // Whether this group of options should be listed first
                var topGroup = false;

                // Sort by priority, then only take the object, without the priority
                // While sorting, figure out which of the categories should be at the top of the 
                // search bar. If a group contains the autofill suggestion, it should move to the top.
                //
                // The filters group should go above all of the other groups of options. Since
                // we can guarentee the filters are the last group in this.state.groupedOptions,
                // they will be moved to the top of the list of options last
                var sortedOptions = group.sortBy(function (opt) {
                    var priority = opt[1];

                    // group contains the autofill suggestion
                    if (priority === 0) {
                        topGroup = true;
                    }
                    return priority;
                }).map(function (opt) {
                    var option = opt[0];
                    
                    //  group contains the filters so should be at top of list.
                    if (option.type === "filter") {
                        topGroup = true;
                    }

                    return option;
                });

                if (topGroup) {
                    return sortedOptions.concat(filteredOptions);
                }
                return filteredOptions.concat(sortedOptions);
            }, Immutable.List());

            if (truncate) {
                return optionList.take(this.props.maxOptions);
            }

            return optionList;
        },

        /** @ignore */
        _handleDialogClick: function (event) {
            this.refs.datalist.removeAutofillSuggestion();
            event.stopPropagation();
        },
        
        /**
         * Perform action based on ID
         *
         * @private
         * @type {Datalist~onChange}
         * @param {string=} id of the selected option
         * @param {string} searchTerm user input
         * @return {{dontCloseDialog: boolean=}};
         */
        _handleChange: function (id, searchTerm) {
            if (!id) {
                this.props.dismissDialog();
                return;
            }

            // These category filters, e.g. Choosing to search items only within the filter "Pixel Layers"
            var filters = this.state.filters,
                lastFilter = filters[filters.length - 1],
                filtersString,
                idSplit = id.split("-"),
                type = idSplit[0],
                // Possible current types are Menu_Command, Current_Doc, Recent_Doc, All_Layers
                category = "category-" + type;

            // Seeing if filters are active or not for analytics
            if (filters.length === 0) {
                filtersString = "filter-inactive";
            } else {
                filtersString = "filter-active";
            }

            var flux = this.getFlux(),
                searchStore = flux.store("search"),
                // This payload will be used to dictate whether given the applied filters (0 or more), if 
                // we want to take any action in the case the user input returns no search results
                registeredSearchPayload = lastFilter ? searchStore.getPayloadFromFilter(lastFilter) : null;

            if (id !== PLACEHOLDER_ID) {
                // This indicates there is a match to the user's input and they have selected an option
                // from the datalist of options
                if (_.contains(this.state.filterIDs, id)) {
                    this._updateFilter(id);
                    
                    // Keep the Datalist dialog option.
                    return { dontCloseDialog: true };
                } else {
                    this.props.executeOption(id);
                    headlights.logEvent("search", filtersString, _.kebabCase(category));
                }
            } else {
                // This indicates that the user has selected the default option when the datalist returns 
                // no matching results to the user's input.
                if (registeredSearchPayload && registeredSearchPayload.noOptionsDefault) {
                    // Need to check if there is action to be taken when there are no options
                    this.props.executeOption(searchTerm, registeredSearchPayload.noOptionsDefault().noOptionsExecute);
                } else {
                    return { dontCloseDialog: true };
                }
            }
        },
        
        /**
         * Handle input change. 
         *
         * @private
         * @param {SyntheticEvent} event
         * @param {Datalist~onInput} value
         */
        _handleInput: function (event, value) {
            var nextHasInputValue = value.length !== 0;
            
            if (nextHasInputValue !== this.state.hasInputValue) {
                this.setState({
                    hasInputValue: nextHasInputValue
                });
            }
        },

        /**
         * @private
         * @type {Datalist~onKeyDown}
         * @param {SyntheticEvent} event
         * @param {string} selectedID the id of the selected item in the datalist
         * @param {Array.<Option>} optionsList of all the available filtered options
         */
        _handleKeyDown: function (event, selectedID, optionsList) {
            switch (event.key) {
            case "Return":
                var noOptionsExecute = optionsList ? optionsList.first().handleExecute : null;
                if (!noOptionsExecute) {
                    return { preventListDefault: true };
                }
                break;
            case "Enter":
                if (selectedID === PLACEHOLDER_ID || !selectedID) {
                    this._handleDialogClick(event, selectedID);
                } else if (_.contains(this.state.filterIDs, selectedID)) {
                    this._updateFilter(selectedID);

                    // Keep the list open for the new filtered results
                    return { preventListDefault: true };
                }
                break;
            case "Tab":
                event.preventDefault();
                return { preventListDefault: true };
            case "Escape":
                if (selectedID === PLACEHOLDER_ID) {
                    headlights.logEvent("tools", "search", "failed-search");
                }
                this.props.dismissDialog();
                break;
            case "Backspace":
                if (this.refs.datalist.cursorAtBeginning() && this.state.filters.length > 0) {
                    // Clear filter and icon
                    this._updateFilter(null);
                }
                break;
            }
        },

        /** @ignore */
        _clearInput: function () {
            this._updateFilter(null);
            this._updateDatalistInput(null);
            this.setState({ hasInputValue: false });
        },

        render: function () {
            var searchStrings = nls.localize("strings.SEARCH"),
                filters = this.state.filters,
                placeholderText,
                clearInputBtn;

            var flux = this.getFlux(),
                searchStore = flux.store("search"),
                lastFilter = filters[filters.length - 1];

            var searchPayload = searchStore.getPayloadFromFilter(lastFilter),
                // This returns a function that when called will return an object with the various properties
                // for the case when that filter has no options associated with it
                noOptions = searchPayload ? searchPayload.noOptionsDefault : null,
                noOptionsObject = noOptions ? noOptions() : null,
                noOptionsString = noOptionsObject ? noOptionsObject.noOptionsString : null,
                noOptionsExecute = noOptionsObject ? noOptionsObject.noOptionsExecute : null,
                noOptionsType = noOptionsObject ? noOptionsObject.noOptionsType : "placeholder",
                defaultNoOptionsString = nls.localize("strings.SEARCH.NO_OPTIONS");

            var noMatchesOption = {
                id: PLACEHOLDER_ID,
                title: noOptionsString ? noOptionsString : defaultNoOptionsString,
                titleType: noOptionsString ? "custom" : "default",
                handleExecute: noOptionsExecute,
                type: noOptionsType
            };

            // If we have applied a filter, change the placeholder text
            if (filters.length > 0) {
                var categoryString = searchStrings.CATEGORIES[lastFilter],
                    category = categoryString ?
                        categoryString : this.state.safeFilterNameMap[lastFilter];
                placeholderText = searchStrings.PLACEHOLDER_FILTER + category;
            } else if (!this.state.ready) {
                placeholderText = searchStrings.PLACEHOLDER_INITIALIZING;
            } else {
                placeholderText = searchStrings.PLACEHOLDER;
            }
            
            if (this.state.hasInputValue) {
                clearInputBtn = (
                    <Button
                        title="Clear Search Input"
                        className="button-clear-search"
                        onClick={this._clearInput} >
                        <SVGIcon
                            CSSID="layer-search-clear" />
                    </Button>
                );
            }

            return (
                <div
                    onClick={this._handleDialogClick}>
                   <SVGIcon
                        CSSID="layer-search-app" />
                   <Datalist
                        ref="datalist"
                        disabled={!this.state.ready}
                        className="dialog-search-bar"
                        options={this.state.options}
                        startFocused={true}
                        placeholderText={placeholderText}
                        placeholderOption={noMatchesOption}
                        filterIcon={this.state.icon}
                        filterOptions={this._filterSearchOptions}
                        useAutofill={true}
                        neverSelectAllInput={true}
                        changeOnBlur={false}
                        onChange={this._handleChange}
                        onInput={this._handleInput}
                        onKeyDown={this._handleKeyDown} />
                    {clearInputBtn}
                </div>
            );
        }
    });

    module.exports = SearchBar;
});
