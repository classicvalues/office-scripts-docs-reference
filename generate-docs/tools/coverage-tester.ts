#!/usr/bin/env node --harmony

import * as fsx from 'fs-extra';
import * as jsyaml from "js-yaml";
import * as path from "path";

/**
 * The type of API being measured
 */
enum ApiType{
    Class = "Class",
    Enum = "Enum",
    EnumField = "EnumField",
    Property = "Property",
    Method = "Method"
}

/**
 * A measure for how "good" an API description is.
 */
enum DescriptionRating {
    Missing = "Missing", // No description
    Poor = "Poor", // Fewer than 10 words
    Fine = "Fine", // One sentence (more than 10 words)
    Good = "Good", // Multiple sentences
}

/**
 * A combination of description quality and example usage to measure coverage.
 */
class CoverageRating {
    type: ApiType;
    descriptionRating: DescriptionRating;
    hasExample: boolean;
}

/**
 * The coverage of a class, which includes ratings for every field and the base description and example.
 */
class ClassCoverageRating {
    apiRatings: Map<string, CoverageRating>;
    classRating: CoverageRating;
    
    constructor() {
        this.apiRatings = new Map();
        this.classRating = {
            type: ApiType.Class,
            descriptionRating: DescriptionRating.Missing,
            hasExample: false
        };
    }
}

/**
 * A YAML schema for fields (enum values).
 */
class ApiFieldYaml {
    name: string;
    uid: string;
    package: string;
    summary: string;
    remarks?: string;
}

/**
 * A YAML schema for properties.
 */
class ApiPropertyYaml {
    name: string;
    uid: string;
    package: string;
    fullName: string;
    summary: string;
    remarks?: string;
    isPreview: false
    isDeprecated: false
    syntax: {
        content: string;
        return: {
            type: string;
            description?: string;
        }
    }
}

/**
 * A YAML schema for methods.
 */
class ApiMethodYaml {
    name: string;
    uid: string;
    package: string;
    fullName: string;
    summary: string;
    remarks?: string;
    isPreview: boolean;
    isDeprecated: boolean;
    syntax: {
      content: string;
      parameters?: {
        id: string;
        description: string;
        type: string;
      }[];
      return: {
        type: string;
        description: string;
      };
    };
}

/**
 * The YAML schema for a class, interface, or enum.
 */
interface ApiYaml {
    name: string;
    uid: string;
    package: string;
    fullName: string;
    summary: string;
    remarks: string;
    isPreview: boolean;
    isDeprecated: boolean;
    type: string;
    fields?: ApiFieldYaml[];
    properties?: ApiPropertyYaml[];
    methods?: ApiMethodYaml[];
} 

/* Start tool */
// Create the coverage object for the API set.
let ratingMap: Map<string, ClassCoverageRating> = new Map();

// Read and evaluate each yml file.
const docsSource = path.resolve("../../docs/docs-ref-autogen/excel/excelscript");
fsx.readdirSync(docsSource)
    .forEach(filename => {
        let ymlFile = jsyaml.load(fsx.readFileSync(docsSource + '/' + filename).toString()) as ApiYaml;
        let rating = rateClass(ymlFile);
        ratingMap.set(ymlFile.name, rating);
});

// Create a csv report.
let csvString = convertToCsv(ratingMap);
fsx.writeFileSync(path.resolve("./") + "/API Coverage Report.csv",csvString);

process.exit(0);

function rateClass(classYml: ApiYaml) : ClassCoverageRating {
    let ymlCoverage = new ClassCoverageRating();
    ymlCoverage.classRating = rateClassDescription(classYml);

    classYml.fields?.forEach((field) => {
        // Note: examples in enum fields are intentionally not supported.
        ymlCoverage.apiRatings.set(field.name, {
            type: ApiType.EnumField,
            descriptionRating: rateDescriptionString(field.summary),
            hasExample: false
        });
    });

    classYml.properties?.forEach((field) => {
        ymlCoverage.apiRatings.set(field.name, rateFieldDescription(field, false));
    });

    classYml.methods?.forEach((field) => {
        let name = field.name.indexOf(",") < 0 ? field.name : field.name.substring(0, field.name.indexOf(","));
        ymlCoverage.apiRatings.set(name, rateFieldDescription(field, true));
    });

    return ymlCoverage;
}

function rateClassDescription(classYml: ApiYaml) : CoverageRating {
    let rating : CoverageRating;
    let type: ApiType = classYml.type === "interface" || classYml.type === "class" ? ApiType.Class : ApiType.Enum;
    let indexOfExample = classYml.remarks?.indexOf("#### Examples");
    if (indexOfExample >= 0) {
        rating = {
            type: type,
            descriptionRating: rateDescriptionString((classYml.summary + " " + classYml.remarks.substring(0, indexOfExample)).trim()),
            hasExample: true
        }
    } else {
        rating = {
            type: type,
            descriptionRating: rateDescriptionString((classYml.summary + " " + classYml.remarks).trim()),
            hasExample: false
        }
    }

    return rating;
}

function rateFieldDescription(fieldYml: ApiPropertyYaml | ApiMethodYaml, isMethod: boolean) : CoverageRating {
    let rating : CoverageRating;
    let indexOfExample = fieldYml.remarks?.indexOf("#### Examples");
    if (!indexOfExample || indexOfExample < 0) {
        indexOfExample = fieldYml.syntax.return.description?.indexOf("#### Examples")
    }

    if (indexOfExample >= 0) {
        rating = {
            type: isMethod ? ApiType.Method : ApiType.Property,
            descriptionRating: rateDescriptionString((fieldYml.summary + " " + fieldYml.remarks.substring(0, indexOfExample)).trim()),
            hasExample: true
        }
    } else {
        rating = {
            type: isMethod ? ApiType.Method : ApiType.Property,
            descriptionRating: rateDescriptionString((fieldYml.summary + " " + fieldYml.remarks).trim()),
            hasExample: false
        }
    }

    if (isMethod) {
        let methodYml = fieldYml as ApiMethodYaml;
        let descriptionRatings = [rateDescriptionString(methodYml.syntax.return.description), rating.descriptionRating];
        methodYml.syntax.parameters?.forEach((parameter) => {
            descriptionRatings.push(rateDescriptionString(parameter.description));
        });
        rating.descriptionRating = averageDescriptionRatings(descriptionRatings);
    }

    return rating;
}

function rateDescriptionString(description: string) : DescriptionRating{
    if (description === "") {
        return DescriptionRating.Missing;
    }

    let sentenceCount = description.split(". ").length;
    let wordCount = description.split(" ").length;
    if (wordCount < 10) {
        return DescriptionRating.Poor;
    } else if (sentenceCount < 2) {
        return DescriptionRating.Fine;
    } else {
        return DescriptionRating.Good;
    }
}

function averageDescriptionRatings(ratings: DescriptionRating[]) : DescriptionRating {
    let ratingScore = 0;
    ratings.forEach((rating) => {
        switch (rating) {
            case DescriptionRating.Missing:
                return DescriptionRating.Missing;
            case DescriptionRating.Poor:
                ratingScore += 1;
                break;
            case DescriptionRating.Fine:
                ratingScore += 2;
                break;
            case DescriptionRating.Good:
                ratingScore += 3;
                break;
        }
    });

    ratingScore /= ratings.length;
    if (ratingScore === 3) {
        return DescriptionRating.Good;
    } else if (ratingScore > 2) {
        return DescriptionRating.Fine;
    } else {
        return DescriptionRating.Poor;
    }
}

function convertToCsv(apiCoverage: Map<string, ClassCoverageRating>) : string {
    let csvString = "Class,Field,Type,Description Rating,Has Example?\n";
    apiCoverage.forEach((coverage, className) => {
        csvString += `${className},N/A,${coverage.classRating.type},${coverage.classRating.descriptionRating},${coverage.classRating.hasExample}\n`;
        coverage.apiRatings.forEach((fieldCoverage, fieldName) => {
            csvString += `${className},${fieldName},${fieldCoverage.type},${fieldCoverage.descriptionRating},${fieldCoverage.hasExample}\n`;
        });
    });

    return csvString
}